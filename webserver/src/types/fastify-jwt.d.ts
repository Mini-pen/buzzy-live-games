import type { JwtPlayerPayload } from "../domain/types.js";

declare module "@fastify/jwt" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyJWT {
    payload: JwtPlayerPayload;
    user: JwtPlayerPayload;
  }
}
