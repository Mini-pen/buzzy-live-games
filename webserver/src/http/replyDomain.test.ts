import { describe, expect, it } from "vitest";

import { replyDomain } from "./replyDomain.js";

describe("replyDomain", () => {
  function mockReply() {
    let statusCode = 200;
    let sentData: unknown = null;

    return {
      status(code: number) {
        statusCode = code;
        return this;
      },
      send(data: unknown) {
        sentData = data;
        return this;
      },
      getStatus() {
        return statusCode;
      },
      getSentData() {
        return sentData;
      },
    };
  }

  it("returns 400 by default for unknown error codes", () => {
    const reply = mockReply();
    const err = new Error("Something went wrong");
    (err as unknown as { code: string }).code = "UNKNOWN_ERROR";
    replyDomain(reply as never, err);
    expect(reply.getStatus()).toBe(400);
    expect(reply.getSentData()).toEqual({
      error: "UNKNOWN_ERROR",
      message: "Something went wrong",
    });
  });

  it("returns 401 for UNAUTHORIZED", () => {
    const reply = mockReply();
    const err = new Error("Not authorized");
    (err as unknown as { code: string }).code = "UNAUTHORIZED";
    replyDomain(reply as never, err);
    expect(reply.getStatus()).toBe(401);
  });

  it("returns 403 for FORBIDDEN", () => {
    const reply = mockReply();
    const err = new Error("Access denied");
    (err as unknown as { code: string }).code = "FORBIDDEN";
    replyDomain(reply as never, err);
    expect(reply.getStatus()).toBe(403);
  });

  it("returns 404 for NOT_FOUND", () => {
    const reply = mockReply();
    const err = new Error("Resource not found");
    (err as unknown as { code: string }).code = "NOT_FOUND";
    replyDomain(reply as never, err);
    expect(reply.getStatus()).toBe(404);
  });

  it("returns 409 for PARTY_CLOSED", () => {
    const reply = mockReply();
    const err = new Error("Party is closed");
    (err as unknown as { code: string }).code = "PARTY_CLOSED";
    replyDomain(reply as never, err);
    expect(reply.getStatus()).toBe(409);
  });

  it("returns 410 for PARTY_GONE", () => {
    const reply = mockReply();
    const err = new Error("Party deleted");
    (err as unknown as { code: string }).code = "PARTY_GONE";
    replyDomain(reply as never, err);
    expect(reply.getStatus()).toBe(410);
  });

  it("returns 503 for JOIN_CODE_EXHAUSTED", () => {
    const reply = mockReply();
    const err = new Error("No codes available");
    (err as unknown as { code: string }).code = "JOIN_CODE_EXHAUSTED";
    replyDomain(reply as never, err);
    expect(reply.getStatus()).toBe(503);
  });

  it("returns 500 for non-Error objects", () => {
    const reply = mockReply();
    replyDomain(reply as never, "plain string error");
    expect(reply.getStatus()).toBe(500);
    expect(reply.getSentData()).toEqual({ error: "INTERNAL" });
  });

  it("uses BAD_REQUEST code when code property is missing", () => {
    const reply = mockReply();
    const err = new Error("Generic error");
    replyDomain(reply as never, err);
    expect(reply.getStatus()).toBe(400);
    expect(reply.getSentData()).toEqual({
      error: "BAD_REQUEST",
      message: "Generic error",
    });
  });
});
