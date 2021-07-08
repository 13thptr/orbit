import Dexie, {
  Collection,
  IndexableType,
  PromiseExtended,
  WhereClause,
} from "dexie";
import { Entity, Event, EventID, IDOfEntity, TaskID } from "../../core2";
import { EntityID, EntityType } from "../../core2/entities/entityBase";
import {
  DatabaseEntityQuery,
  DatabaseEventQuery,
  DatabaseQueryPredicate,
} from "../../database";
import { DatabaseBackend, DatabaseBackendEntityRecord } from "../backend";
import { DexieDatabase } from "./dexie/dexie";
import {
  DexieDerivedTaskComponentKeys,
  DexieEntityKeys,
  DexieEntityRow,
  DexieEntityRowWithPrimaryKey,
  DexieEventKeys,
  DexieEventRow,
  DexieEventRowWithPrimaryKey,
} from "./dexie/tables";

export class IDBDatabaseBackend implements DatabaseBackend {
  db: DexieDatabase;

  constructor(
    indexDB: IDBFactory = window.indexedDB,
    databaseName = "OrbitDatabase",
  ) {
    this.db = new DexieDatabase(databaseName, indexDB);
  }

  async close(): Promise<void> {
    // Warning: we have no way to ensure that all writes have resolved before this statement completes
    this.db.close();
  }

  async getEntities<E extends Entity, ID extends IDOfEntity<E>>(
    entityIDs: ID[],
  ): Promise<Map<ID, DatabaseBackendEntityRecord<E>>> {
    const values = await this.db.entities
      .where(DexieEntityKeys.ID)
      .anyOf(entityIDs)
      .toArray();

    const output: Map<ID, DatabaseBackendEntityRecord<E>> = new Map();
    for (const value of values) {
      if (!value) continue;
      const entity: E = JSON.parse(value.data);
      output.set(value.id as ID, {
        lastEventID: value.lastEventID as EventID,
        entity,
      });
    }
    return output;
  }

  async getEvents<E extends Event, ID extends EventID>(
    eventIDs: EventID[],
  ): Promise<Map<ID, E>> {
    const values = await this.db.events
      .where(DexieEventKeys.ID)
      .anyOf(eventIDs)
      .toArray();

    const output: Map<ID, E> = new Map();
    for (const value of values) {
      if (!value) continue;
      const entity: E = JSON.parse(value.data);
      output.set(value.id as ID, entity);
    }
    return output;
  }

  async listEntities<E extends Entity>(
    query: DatabaseEntityQuery<E>,
  ): Promise<DatabaseBackendEntityRecord<E>[]> {
    if (query.entityType !== EntityType.Task) {
      // Haven't actually added this column to the DB; we can do that when it's needed.
      throw new Error(`Unsupported entity type in query: ${query.entityType}`);
    }

    let request: PromiseExtended<DexieEntityRow[]>;
    if (query.predicate) {
      const includedTaskIDs = new Set<TaskID>();
      // only one possible key right now, when another key is eventually defined convert this
      // to be an if-else
      switch (query.predicate[0]) {
        case DexieDerivedTaskComponentKeys.DueTimestampMillis:
          const clause = this.db.derived_taskComponents.where(
            DexieDerivedTaskComponentKeys.DueTimestampMillis,
          );
          const derivedRowsPrimaryKeys = await compareUsingPredicate(
            clause,
            query.predicate,
          ).primaryKeys();

          for (const [derivedPrimaryKey] of derivedRowsPrimaryKeys) {
            includedTaskIDs.add(derivedPrimaryKey as TaskID);
          }
      }

      // was the afterID specified at the same time?
      if (query.afterID) {
        // simulate a join across the two tables
        const afterRowID = await this._fetchPrimaryKeyFromUniqueKey(
          this.db.entities,
          DexieEventKeys.ID,
          query.afterID,
        );

        // Note that our approach here involves fetching _all_ matching entity IDs, then skipping the
        // ones before the requested row. This means pagination over N entities with a predicate has
        // quadratic time cost.
        // rows are already sorted since we are using the primary key index
        const baseQuery = this.db.entities
          .where(DexieEntityKeys.RowID)
          .above(afterRowID)
          .filter((row) => includedTaskIDs.has(row.id));
        request = applyOptionalLimit(baseQuery, query.limit).toArray();
      } else {
        const baseQuery = this.db.entities
          .where(DexieEntityKeys.ID)
          .anyOf([...includedTaskIDs]);
        request = applyOptionalLimit(baseQuery, query.limit).sortBy(
          DexieEntityKeys.RowID,
        );
      }
    } else if (query.afterID) {
      const afterRowID = await this._fetchPrimaryKeyFromUniqueKey(
        this.db.entities,
        DexieEventKeys.ID,
        query.afterID,
      );
      // already sorted queried using primary key index
      const baseQuery = this.db.entities
        .where(DexieEntityKeys.RowID)
        .above(afterRowID);
      request = applyOptionalLimit(baseQuery, query.limit).toArray();
    } else {
      request = applyOptionalLimit(
        this.db.entities.toCollection(),
        query.limit,
      ).toArray();
    }

    const queriedEntities = await request;
    return queriedEntities.map((entity) => ({
      lastEventID: entity.lastEventID,
      entity: JSON.parse(entity.data),
    }));
  }

  async listEvents(query: DatabaseEventQuery): Promise<Event[]> {
    let request: PromiseExtended<DexieEventRow[]>;

    if (query.predicate && query.afterID) {
      const afterSequenceNumber = await this._fetchPrimaryKeyFromUniqueKey(
        this.db.events,
        DexieEventKeys.ID,
        query.afterID,
      );

      // both the predicate and afterID were specified need to do more complex querying
      if (query.predicate[1] == "=") {
        // can create a compound query in this case. It is already sorted since the primary key is the final
        // column of the index
        const baseQuery = this.db.events
          .where(`[${query.predicate[0]}+${DexieEventKeys.SequenceNumber}]`)
          .between(
            [query.predicate[2], afterSequenceNumber + 1],
            [query.predicate[2], Dexie.maxKey],
          );

        request = applyOptionalLimit(baseQuery, query.limit).toArray();
      } else {
        // arbitrary comparison query
        const predicatedQuery = this.db.events.where(
          query.predicate[0],
        ) as WhereClause<DexieEventRowWithPrimaryKey, number>;

        const baseQuery = compareUsingPredicate(
          predicatedQuery,
          query.predicate,
        ).filter(
          (item) => item[DexieEventKeys.SequenceNumber] > afterSequenceNumber,
        );
        request = applyOptionalLimit(baseQuery, query.limit).sortBy(
          DexieEventKeys.SequenceNumber,
        );
      }
    } else if (query.predicate) {
      const predicatedQuery = this.db.events.where(query.predicate[0]);
      request = applyOptionalLimit(
        compareUsingPredicate(predicatedQuery, query.predicate),
        query.limit,
      ).sortBy(DexieEventKeys.SequenceNumber);
    } else if (query.afterID) {
      const afterSequenceNumber = await this._fetchPrimaryKeyFromUniqueKey(
        this.db.events,
        DexieEventKeys.ID,
        query.afterID,
      );

      // already sorted since fetching using primary key;
      const baseQuery = this.db.events
        .where(DexieEventKeys.SequenceNumber)
        .above(afterSequenceNumber);
      request = applyOptionalLimit(baseQuery, query.limit).toArray();
    } else {
      request = applyOptionalLimit(
        this.db.events.toCollection(),
        query.limit,
      ).toArray();
    }

    const queriedEvents: DexieEventRow[] = await request;
    return queriedEvents.map((event) => JSON.parse(event.data));
  }

  async modifyEntities(
    ids: EntityID[],
    transformer: (
      row: Map<EntityID, DexieEntityRowWithPrimaryKey>,
    ) => Map<EntityID, DexieEntityRowWithPrimaryKey>,
  ) {
    await this.db.transaction(
      "readwrite",
      this.db.entities,
      this.db.derived_taskComponents,
      async () => {
        const rows = await this.db.entities
          .where(DexieEntityKeys.ID)
          .anyOf(ids)
          .toArray();

        const rowMapping = rows.reduce((map, row) => {
          map.set(row.id, row as DexieEntityRowWithPrimaryKey);
          return map;
        }, new Map<EntityID, DexieEntityRowWithPrimaryKey>());

        const transformedEntities = transformer(rowMapping).values();
        const transformedRows = Array<DexieEntityRowWithPrimaryKey>();
        for (const row of transformedEntities) {
          transformedRows.push({
            rowID: row.rowID,
            id: row.id,
            lastEventID: row.lastEventID,
            data: row.data,
          });
        }
        await this.db.entities.bulkPut(transformedRows);
      },
    );
  }

  async putEntities(
    entities: DatabaseBackendEntityRecord<Entity>[],
  ): Promise<void> {
    await this.db.transaction(
      "readwrite",
      this.db.entities,
      this.db.derived_taskComponents,
      async () => {
        const newEntities = entities.map((record) => ({
          id: record.entity.id,
          lastEventID: record.lastEventID,
          data: JSON.stringify(record.entity),
        }));

        await this.db.entities.bulkPut(newEntities);
      },
    );
  }

  async putEvents(events: Event[]): Promise<void> {
    this.db.transaction("rw", this.db.events, async () => {
      await this.db.events.bulkAdd(
        events.map((event) => ({
          entityID: event.entityID,
          id: event.id,
          data: JSON.stringify(event),
        })),
      );
    });
  }

  async _fetchPrimaryKeyFromUniqueKey<Row, PK>(
    table: Dexie.Table<Row, PK>,
    key: string,
    value: IndexableType,
  ): Promise<PK> {
    // there will never be more then one key
    const afterRowPrimaryKeys = await table
      .where(key)
      .equals(value)
      .primaryKeys();
    return afterRowPrimaryKeys[0];
  }
}

function applyOptionalLimit<Row, PK>(
  query: Collection<Row, PK>,
  limit: number | undefined,
) {
  if (limit) {
    return query.limit(limit);
  } else {
    return query;
  }
}

function compareUsingPredicate<
  Row,
  PK,
  Key extends string,
  Value extends IndexableType,
>(clause: WhereClause<Row, PK>, predicate: DatabaseQueryPredicate<Key, Value>) {
  switch (predicate[1]) {
    case "<":
      return clause.below(predicate[2]);
    case "<=":
      return clause.belowOrEqual(predicate[2]);
    case "=":
      return clause.equals(predicate[2]);
    case ">":
      return clause.above(predicate[2]);
    case ">=":
      return clause.aboveOrEqual(predicate[2]);
  }
}
