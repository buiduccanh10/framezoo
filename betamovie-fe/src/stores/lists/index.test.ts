import { beforeEach, describe, expect, it } from "vitest";

import { useListStore } from "@/stores/lists";

describe("useListStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useListStore.getState().clear();
  });

  it("replaces, upserts, and removes lists", () => {
    useListStore.getState().replaceLists({
      one: {
        id: "one",
        userId: "user-1",
        name: "One",
        description: null,
        public: false,
        createdAt: 1,
        updatedAt: 2,
        items: [],
      },
    });

    expect(Object.keys(useListStore.getState().lists)).toEqual(["one"]);

    useListStore.getState().upsertList({
      id: "two",
      userId: "user-1",
      name: "Two",
      description: "desc",
      public: true,
      createdAt: 3,
      updatedAt: 4,
      items: [],
    });

    expect(Object.keys(useListStore.getState().lists)).toEqual(["one", "two"]);

    useListStore.getState().removeList("one");

    expect(Object.keys(useListStore.getState().lists)).toEqual(["two"]);
  });
});
