import { getClient } from './client.js';

// Returns a pg client with RLS session vars set for the calling user
export async function getRlsClient(user) {
  const client = await getClient();
  await client.query(`SET LOCAL app.user_id = '${user.id}'`);
  await client.query(`SET LOCAL app.user_role = '${user.role}'`);
  return client;
}
