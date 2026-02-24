import { describe, it, expect } from "vitest";
import { extractEndpoints, parseSpec } from "./openapi.js";

describe("extractEndpoints", () => {
  it("extracts basic GET and POST endpoints", () => {
    const spec = {
      paths: {
        "/users": {
          get: { summary: "List users" },
          post: { description: "Create user" },
        },
      },
    };
    const eps = extractEndpoints(spec);
    expect(eps).toHaveLength(2);
    expect(eps[0]).toEqual({
      path: "/users",
      method: "GET",
      description: "List users",
      parameters: [],
    });
    expect(eps[1]).toEqual({
      path: "/users",
      method: "POST",
      description: "Create user",
      parameters: [],
    });
  });

  it("skips non-HTTP keys like parameters and $ref", () => {
    const spec = {
      paths: {
        "/items": {
          parameters: [{ name: "id", in: "path" }],
          get: { summary: "Get item" },
        },
      },
    };
    const eps = extractEndpoints(spec);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.method).toBe("GET");
  });

  it("extracts inline parameters", () => {
    const spec = {
      paths: {
        "/search": {
          get: {
            summary: "Search",
            parameters: [
              { name: "q", in: "query" },
              { name: "page", in: "query" },
            ],
          },
        },
      },
    };
    const eps = extractEndpoints(spec);
    expect(eps[0]!.parameters).toEqual(["q", "page"]);
  });

  it("resolves $ref in parameters", () => {
    const spec = {
      components: {
        parameters: {
          PageSize: { name: "page_size", in: "query" },
        },
      },
      paths: {
        "/items": {
          get: {
            summary: "List items",
            parameters: [
              { $ref: "#/components/parameters/PageSize" },
              { name: "sort", in: "query" },
            ],
          },
        },
      },
    };
    const eps = extractEndpoints(spec);
    expect(eps[0]!.parameters).toEqual(["page_size", "sort"]);
  });

  it("resolves $ref at the path item level", () => {
    const spec = {
      components: {
        pathItems: {
          UserById: {
            get: { summary: "Get user by ID" },
            delete: { summary: "Delete user" },
          },
        },
      },
      paths: {
        "/users/{id}": { $ref: "#/components/pathItems/UserById" },
      },
    };
    const eps = extractEndpoints(spec);
    expect(eps).toHaveLength(2);
    expect(eps.map((e) => e.method).sort()).toEqual(["DELETE", "GET"]);
  });

  it("merges path-level and operation-level parameters", () => {
    const spec = {
      paths: {
        "/users/{id}": {
          parameters: [{ name: "id", in: "path" }],
          get: {
            summary: "Get user",
            parameters: [{ name: "fields", in: "query" }],
          },
          put: { summary: "Update user" },
        },
      },
    };
    const eps = extractEndpoints(spec);
    const getEp = eps.find((e) => e.method === "GET")!;
    const putEp = eps.find((e) => e.method === "PUT")!;
    expect(getEp.parameters).toEqual(["id", "fields"]);
    expect(putEp.parameters).toEqual(["id"]);
  });

  it("returns empty array for missing paths", () => {
    expect(extractEndpoints({})).toEqual([]);
    expect(extractEndpoints({ paths: null } as any)).toEqual([]);
  });

  it("handles all HTTP methods", () => {
    const spec = {
      paths: {
        "/resource": {
          get: {},
          post: {},
          put: {},
          patch: {},
          delete: {},
          head: {},
          options: {},
        },
      },
    };
    const eps = extractEndpoints(spec);
    expect(eps).toHaveLength(7);
  });
});

describe("parseSpec", () => {
  it("parses valid JSON", () => {
    const raw = '{"openapi":"3.0.0","paths":{"/health":{"get":{}}}}';
    const spec = parseSpec(raw);
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.paths).toBeDefined();
  });

  it("parses valid YAML", () => {
    const raw = `
openapi: "3.0.0"
paths:
  /health:
    get:
      summary: Health check
`;
    const spec = parseSpec(raw);
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.paths).toBeDefined();
  });

  it("throws on missing paths key", () => {
    expect(() => parseSpec('{"openapi":"3.0.0"}')).toThrow("paths");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSpec("{invalid json")).toThrow();
  });

  it("throws on array input", () => {
    expect(() => parseSpec("[1,2,3]")).toThrow("object");
  });

  it("prefers JSON parsing for objects starting with {", () => {
    const raw = '{"paths":{"/a":{"get":{"summary":"test"}}}}';
    const spec = parseSpec(raw);
    expect(spec.paths).toBeDefined();
  });
});
