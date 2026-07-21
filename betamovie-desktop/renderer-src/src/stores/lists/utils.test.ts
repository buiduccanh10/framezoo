import { describe, expect, it } from "vitest";

import {
  buildListMembershipUpdates,
  normalizeListResponse,
} from "@/stores/lists/utils";

describe("list utils", () => {
  it("normalizes raw list responses", () => {
    const result = normalizeListResponse({
      id: "list-1",
      user_id: "user-1",
      name: "Weekend",
      description: "My picks",
      public: true,
      created_at: "2026-06-22T00:00:00.000Z",
      updated_at: "2026-06-22T01:00:00.000Z",
      list_items: [
        {
          id: "item-1",
          list_id: "list-1",
          tmdb_id: "100",
          type: "movie",
          added_at: "2026-06-22T00:00:00.000Z",
        },
      ],
    });

    expect(result).toMatchObject({
      id: "list-1",
      userId: "user-1",
      name: "Weekend",
      description: "My picks",
      public: true,
      items: [
        {
          id: "item-1",
          listId: "list-1",
          tmdbId: "100",
          type: "movie",
        },
      ],
    });
    expect(result.createdAt).toBe(1782086400000);
    expect(result.updatedAt).toBe(1782090000000);
  });

  it("builds membership updates from desired list selection", () => {
    const updates = buildListMembershipUpdates(
      [
        {
          id: "keep",
          userId: "user-1",
          name: "Keep",
          description: null,
          public: false,
          createdAt: 0,
          updatedAt: 0,
          items: [
            {
              id: "i1",
              listId: "keep",
              tmdbId: "42",
              type: "movie",
              addedAt: 0,
            },
          ],
        },
        {
          id: "add",
          userId: "user-1",
          name: "Add",
          description: null,
          public: false,
          createdAt: 0,
          updatedAt: 0,
          items: [],
        },
      ],
      "42",
      "movie",
      ["add"],
    );

    expect(updates).toEqual([
      {
        list_id: "keep",
        removeItems: [{ tmdb_id: "42", type: "movie" }],
      },
      {
        list_id: "add",
        addItems: [{ tmdb_id: "42", type: "movie" }],
      },
    ]);
  });
});
