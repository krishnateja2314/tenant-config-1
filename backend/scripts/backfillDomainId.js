import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/tenant-config";

try {
  await mongoose.connect(MONGO_URI);

  const db = mongoose.connection.db;
  const collectionsToBackfill = ["tenantusers", "admins", "authconfigs"];

  for (const collectionName of collectionsToBackfill) {
    const exists = await db.listCollections({ name: collectionName }).hasNext();

    if (!exists) {
      console.log(`[skip] ${collectionName} does not exist`);
      continue;
    }

    const result = await db
      .collection(collectionName)
      .updateMany(
        { domainId: { $exists: false } },
        { $set: { domainId: null } },
      );

    console.log(
      `[ok] ${collectionName}: matched=${result.matchedCount}, modified=${result.modifiedCount}`,
    );
  }

  await mongoose.disconnect();
} catch (error) {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect error on failure path
  }
  process.exit(1);
}
