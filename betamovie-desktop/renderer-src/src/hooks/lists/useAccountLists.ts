import { useCallback, useMemo } from "react";

import {
  CreateListInput,
  UpdateListInput,
  createList,
  deleteList,
  getLists,
  updateList,
} from "@/backend/accounts/lists";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useAuthStore } from "@/stores/auth";
import { StoredList, useListStore } from "@/stores/lists";
import { sortStoredLists } from "@/stores/lists/utils";

export function useAccountLists() {
  const backendUrl = useBackendUrl();
  const account = useAuthStore((state) => state.account);
  const listsMap = useListStore((state) => state.lists);
  const replaceLists = useListStore((state) => state.replaceLists);
  const upsertList = useListStore((state) => state.upsertList);
  const removeStoredList = useListStore((state) => state.removeList);

  const lists = useMemo(
    () => sortStoredLists(Object.values(listsMap)),
    [listsMap],
  );

  const reloadLists = useCallback(async () => {
    if (!backendUrl || !account) {
      return useListStore.getState().lists;
    }

    const nextLists = await getLists(backendUrl, account);
    replaceLists(nextLists);
    return nextLists;
  }, [account, backendUrl, replaceLists]);

  const createListAndStore = useCallback(
    async (input: CreateListInput): Promise<StoredList> => {
      if (!backendUrl || !account) {
        throw new Error("Missing backend or account");
      }

      const createdList = await createList(backendUrl, account, input);
      upsertList(createdList);
      return createdList;
    },
    [account, backendUrl, upsertList],
  );

  const updateListAndStore = useCallback(
    async (input: UpdateListInput): Promise<StoredList> => {
      if (!backendUrl || !account) {
        throw new Error("Missing backend or account");
      }

      const updatedList = await updateList(backendUrl, account, input);
      upsertList(updatedList);
      return updatedList;
    },
    [account, backendUrl, upsertList],
  );

  const deleteListAndStore = useCallback(
    async (listId: string): Promise<void> => {
      if (!backendUrl || !account) {
        throw new Error("Missing backend or account");
      }

      await deleteList(backendUrl, account, listId);
      removeStoredList(listId);
    },
    [account, backendUrl, removeStoredList],
  );

  return {
    account,
    backendUrl,
    lists,
    listsMap,
    reloadLists,
    createListAndStore,
    updateListAndStore,
    deleteListAndStore,
  };
}
