import { handleRequest } from "../src/server.mjs";

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  await handleRequest(req, res);
}
