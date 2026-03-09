export const storage = {
  bucket: new sst.aws.Bucket("DocProofBucket"),

  table: new sst.aws.Dynamo("DocProofTable", {
    fields: {
      pk: "string",
      sk: "string",
      gsi1pk: "string",
      gsi1sk: "string",
    },
    primaryIndex: { hashKey: "pk", rangeKey: "sk" },
    globalIndexes: {
      gsi1: { hashKey: "gsi1pk", rangeKey: "gsi1sk" },
    },
  }),
};
