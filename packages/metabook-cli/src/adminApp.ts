import admin from "firebase-admin";
import { Attachment, AttachmentID } from "metabook-core";
import {
  getFirebaseKeyForCIDString,
  storageAttachmentsPathComponent,
  storageBucketName,
} from "metabook-firebase-support";
import serviceAccount from "./adminKey.json";

let _adminApp: admin.app.App;
export function getAdminApp() {
  if (!_adminApp) {
    _adminApp = admin.initializeApp({
      // Seems like the cert initializer has the wrong argument type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      credential: admin.credential.cert(serviceAccount as any),
      databaseURL: "https://metabook-system.firebaseio.com",
    });
  }
  return _adminApp;
}

export async function uploadAttachment(
  attachment: Attachment,
  attachmentID: AttachmentID,
): Promise<void> {
  const ref = getAdminApp()
    .storage()
    .bucket(storageBucketName)
    .file(
      `${storageAttachmentsPathComponent}/${getFirebaseKeyForCIDString(
        attachmentID,
      )}`,
    );
  const writeStream = ref.createWriteStream();
  return new Promise((resolve, reject) => {
    writeStream.on("close", resolve);
    writeStream.on("error", reject);
    writeStream.write(attachment.contents);
    writeStream.end();
  });
}
