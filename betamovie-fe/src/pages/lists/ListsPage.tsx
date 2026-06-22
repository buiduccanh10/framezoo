import classNames from "classnames";
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

import { hydrateListItems, updateList } from "@/backend/accounts/lists";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { Spinner } from "@/components/layout/Spinner";
import { WideContainer } from "@/components/layout/WideContainer";
import { MediaGrid } from "@/components/media/MediaGrid";
import { WatchedMediaCard } from "@/components/media/WatchedMediaCard";
import {
  ListFormModal,
  ListFormValues,
} from "@/components/overlays/ListFormModal";
import { Heading1 } from "@/components/utils/Text";
import { useAccountLists } from "@/hooks/lists/useAccountLists";
import { SubPageLayout } from "@/pages/layouts/SubPageLayout";
import { useAuthStore } from "@/stores/auth";
import { HydratedListItem, StoredList } from "@/stores/lists";
import { getListShareUrl } from "@/stores/lists/utils";

function formatDate(value: number) {
  return new Date(value).toLocaleString();
}

function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs text-white/80">
      <Icon
        icon={isPublic ? Icons.UNLOCK : Icons.LOCK}
        className="text-[10px]"
      />
      {isPublic ? t("lists.visibility.public") : t("lists.visibility.private")}
    </span>
  );
}

export function ListsPage() {
  const { t } = useTranslation();
  const account = useAuthStore((state) => state.account);
  const {
    backendUrl,
    lists,
    reloadLists,
    createListAndStore,
    updateListAndStore,
    deleteListAndStore,
  } = useAccountLists();
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [hydratedItems, setHydratedItems] = useState<HydratedListItem[]>([]);
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [savingForm, setSavingForm] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingList, setEditingList] = useState<StoredList | null>(null);
  const [editingItems, setEditingItems] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [copiedListId, setCopiedListId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await reloadLists();
        if (!cancelled) {
          setLoadError(null);
        }
      } catch (error) {
        console.error("Failed to load lists", error);
        if (!cancelled) {
          setLoadError(t("lists.errors.load"));
        }
      } finally {
        if (!cancelled) {
          setLoadingPage(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [reloadLists, t]);

  useEffect(() => {
    if (!lists.length) {
      setSelectedListId(null);
      return;
    }

    if (!selectedListId || !lists.some((list) => list.id === selectedListId)) {
      setSelectedListId(lists[0].id);
    }
  }, [lists, selectedListId]);

  const selectedList = useMemo(
    () => lists.find((list) => list.id === selectedListId) ?? null,
    [lists, selectedListId],
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!selectedList) {
        setHydratedItems([]);
        return;
      }

      setLoadingItems(true);
      try {
        const items = await hydrateListItems(selectedList.items);
        if (!cancelled) {
          setHydratedItems(items);
        }
      } finally {
        if (!cancelled) {
          setLoadingItems(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [selectedList]);

  const handleCreateList = async (values: ListFormValues) => {
    setSavingForm(true);
    try {
      const created = await createListAndStore({
        name: values.name,
        description: values.description || null,
        public: values.public,
      });
      setShowCreateForm(false);
      setSelectedListId(created.id);
    } finally {
      setSavingForm(false);
    }
  };

  const handleUpdateList = async (values: ListFormValues) => {
    if (!editingList) return;

    setSavingForm(true);
    try {
      await updateListAndStore({
        list_id: editingList.id,
        name: values.name,
        description: values.description || null,
        public: values.public,
      });
      setEditingList(null);
    } finally {
      setSavingForm(false);
    }
  };

  const handleDeleteList = async (list: StoredList) => {
    if (!window.confirm(t("lists.delete.confirm", { name: list.name }))) {
      return;
    }

    try {
      await deleteListAndStore(list.id);
    } catch (error) {
      console.error("Failed to delete list", error);
    }
  };

  const handleCopyShare = async (list: StoredList) => {
    try {
      await navigator.clipboard.writeText(
        getListShareUrl(list.id, window.location.origin),
      );
      setCopiedListId(list.id);
      window.setTimeout(() => setCopiedListId(null), 2000);
    } catch (error) {
      console.error("Failed to copy share link", error);
    }
  };

  const handleRemoveItem = async (item: HydratedListItem) => {
    if (!selectedList || !backendUrl || !account) return;

    setBusyItemId(item.ref.id);
    try {
      await updateList(backendUrl, account, {
        list_id: selectedList.id,
        removeItems: [
          {
            tmdb_id: item.ref.tmdbId,
            type:
              item.ref.type ?? (item.media.type === "show" ? "tv" : "movie"),
          },
        ],
      });
      await reloadLists();
    } catch (error) {
      console.error("Failed to remove list item", error);
    } finally {
      setBusyItemId(null);
    }
  };

  return (
    <SubPageLayout>
      <Helmet>
        <title>{t("lists.page.title")}</title>
      </Helmet>

      <WideContainer ultraWide>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Heading1 className="mb-0 text-3xl">{t("lists.page.title")}</Heading1>
          <Button theme="purple" onClick={() => setShowCreateForm(true)}>
            {t("lists.actions.create")}
          </Button>
        </div>

        <div className="mt-4 flex items-center gap-4 pb-8">
          <Button href="/discover" theme="secondary" padding="px-4 py-2">
            {t("discover.page.back")}
          </Button>
        </div>

        {loadingPage ? (
          <div className="flex min-h-[18rem] items-center justify-center">
            <Spinner className="text-2xl text-white" />
          </div>
        ) : loadError ? (
          <div className="rounded-3xl bg-background-main/70 px-8 py-16 text-center">
            <p className="text-xl text-white">{t("lists.page.title")}</p>
            <p className="mx-auto mt-3 max-w-xl text-type-secondary">
              {loadError}
            </p>
            <Button
              theme="purple"
              className="mt-6"
              onClick={() => location.reload()}
            >
              {t("screens.loadingUserError.reload")}
            </Button>
          </div>
        ) : lists.length === 0 ? (
          <div className="rounded-3xl bg-background-main/70 px-8 py-16 text-center">
            <p className="text-xl text-white">{t("lists.empty.title")}</p>
            <p className="mx-auto mt-3 max-w-xl text-type-secondary">
              {t("lists.empty.description")}
            </p>
            <Button
              theme="purple"
              className="mt-6"
              onClick={() => setShowCreateForm(true)}
            >
              {t("lists.actions.create")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-4">
              {lists.map((list) => {
                const isSelected = list.id === selectedListId;

                return (
                  <div
                    key={list.id}
                    className={classNames(
                      "rounded-3xl border p-5 transition-colors",
                      isSelected
                        ? "border-buttons-purple bg-background-main"
                        : "border-white/10 bg-background-main/70",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="truncate text-left text-lg font-semibold text-white"
                          onClick={() => setSelectedListId(list.id)}
                        >
                          {list.name}
                        </button>
                        {list.description ? (
                          <p className="mt-2 line-clamp-2 text-sm text-type-secondary">
                            {list.description}
                          </p>
                        ) : null}
                      </div>
                      <VisibilityBadge isPublic={list.public} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-4 text-xs text-type-secondary">
                      <span>
                        {t("lists.meta.itemCount", {
                          count: list.items.length,
                        })}
                      </span>
                      <span>
                        {t("lists.meta.updatedAt", {
                          date: formatDate(list.updatedAt),
                        })}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        theme={isSelected ? "purple" : "secondary"}
                        padding="px-3 py-2"
                        onClick={() => setSelectedListId(list.id)}
                      >
                        {t("lists.actions.open")}
                      </Button>
                      <Button
                        theme="secondary"
                        padding="px-3 py-2"
                        onClick={() => setEditingList(list)}
                      >
                        {t("lists.actions.edit")}
                      </Button>
                      {list.public ? (
                        <Button
                          theme="secondary"
                          padding="px-3 py-2"
                          onClick={() => handleCopyShare(list)}
                        >
                          {copiedListId === list.id
                            ? t("actions.copied")
                            : t("lists.actions.copyShareLink")}
                        </Button>
                      ) : null}
                      <Button
                        theme="danger"
                        padding="px-3 py-2"
                        onClick={() => handleDeleteList(list)}
                      >
                        {t("lists.actions.delete")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-3xl border border-white/10 bg-background-main p-6">
              {selectedList ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-semibold text-white">
                          {selectedList.name}
                        </h2>
                        <VisibilityBadge isPublic={selectedList.public} />
                      </div>
                      {selectedList.description ? (
                        <p className="mt-3 max-w-3xl text-type-secondary">
                          {selectedList.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        theme={editingItems ? "purple" : "secondary"}
                        padding="px-3 py-2"
                        onClick={() => setEditingItems((prev) => !prev)}
                      >
                        {editingItems
                          ? t("home.mediaList.stopEditing")
                          : t("lists.actions.editItems")}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-4 text-sm text-type-secondary">
                    <span>
                      {t("lists.meta.itemCount", {
                        count: selectedList.items.length,
                      })}
                    </span>
                    <span>
                      {t("lists.meta.updatedAt", {
                        date: formatDate(selectedList.updatedAt),
                      })}
                    </span>
                  </div>

                  <div className="mt-8">
                    {loadingItems ? (
                      <div className="flex min-h-[12rem] items-center justify-center">
                        <Spinner className="text-2xl text-white" />
                      </div>
                    ) : hydratedItems.length === 0 ? (
                      <div className="rounded-2xl bg-background-main/60 px-6 py-12 text-center text-type-secondary">
                        {t("lists.items.empty")}
                      </div>
                    ) : (
                      <MediaGrid>
                        {hydratedItems.map((item) => (
                          <div key={item.ref.id} className="relative">
                            <WatchedMediaCard
                              media={item.media}
                              linkable={item.canShowDetails}
                              closable={editingItems}
                              onClose={
                                busyItemId === item.ref.id
                                  ? undefined
                                  : () => handleRemoveItem(item)
                              }
                            />
                            {busyItemId === item.ref.id ? (
                              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
                                <Spinner className="text-lg text-white" />
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </MediaGrid>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </WideContainer>

      <ListFormModal
        open={showCreateForm}
        title={t("lists.form.createTitle")}
        description={t("lists.form.createDescription")}
        submitLabel={t("lists.actions.create")}
        loading={savingForm}
        onClose={() => setShowCreateForm(false)}
        onSubmit={handleCreateList}
      />

      <ListFormModal
        open={!!editingList}
        title={t("lists.form.editTitle")}
        description={t("lists.form.editDescription")}
        submitLabel={t("lists.actions.save")}
        initialValue={
          editingList
            ? {
                name: editingList.name,
                description: editingList.description ?? "",
                public: editingList.public,
              }
            : undefined
        }
        loading={savingForm}
        onClose={() => setEditingList(null)}
        onSubmit={handleUpdateList}
      />
    </SubPageLayout>
  );
}
