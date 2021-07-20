import { AttachmentMimeType } from "@withorbit/core";
import jestFetchMock from "jest-fetch-mock";
import {
  AttachmentID,
  AttachmentReference,
  EntityType,
} from "@withorbit/core2";
import { AttachmentStoreInMemory } from "./attachmentStoreInMemory";

beforeAll(() => {
  jestFetchMock.enableMocks();
});

beforeEach(() => {
  jestFetchMock.resetMocks();
});

afterAll(() => {
  jestFetchMock.dontMock();
});

let store: AttachmentStoreInMemory;
beforeEach(async () => {
  store = new AttachmentStoreInMemory();
});

const testAttachmentReference: AttachmentReference = {
  id: "x" as AttachmentID,
  createdAtTimestampMillis: 5000,
  type: EntityType.AttachmentReference,
  mimeType: AttachmentMimeType.PNG,
};

test("non-existent ID URL resolves to null", async () => {
  expect(
    await store.getURLForStoredAttachment(testAttachmentReference),
  ).toBeNull();
});

test("after downloading URL resolves", async () => {
  // @ts-ignore
  jestFetchMock.mockResponse("Test");
  await store.storeAttachmentFromURL("http://foo.com", testAttachmentReference);

  const url = await store.getURLForStoredAttachment(testAttachmentReference);
  expect(url).toMatchInlineSnapshot(`"data:image/png;base64,VGVzdA=="`);
});
