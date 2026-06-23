import classNames from "classnames";
import {
  ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
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

type ListSortMode = "recent" | "alphabetical";

function formatShortDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatLongDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

function MetaPill(props: { children: ReactNode; className?: string }) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-sm text-white/80",
        props.className,
      )}
    >
      {props.children}
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
  const [listSearch, setListSearch] = useState("");
  const [sortMode, setSortMode] = useState<ListSortMode>("recent");
  const deferredListSearch = useDeferredValue(listSearch);

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

  const filteredLists = useMemo(() => {
    const normalizedQuery = deferredListSearch.trim().toLowerCase();
    const sortedLists = [...lists].sort((a, b) =>
      sortMode === "alphabetical"
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : b.updatedAt - a.updatedAt,
    );

    if (!normalizedQuery) {
      return sortedLists;
    }

    return sortedLists.filter((list) =>
      [list.name, list.description ?? ""].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [deferredListSearch, lists, sortMode]);

  useEffect(() => {
    if (!lists.length) {
      setSelectedListId(null);
      return;
    }

    if (
      filteredLists.length > 0 &&
      (!selectedListId ||
        !filteredLists.some((list) => list.id === selectedListId))
    ) {
      setSelectedListId(filteredLists[0].id);
      return;
    }

    if (!selectedListId || !lists.some((list) => list.id === selectedListId)) {
      setSelectedListId(lists[0].id);
    }
  }, [filteredLists, lists, selectedListId]);

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

  const publicListCount = lists.filter((list) => list.public).length;
  const hasSearchResults = filteredLists.length > 0;

  return (
    <SubPageLayout>
      <Helmet>
        <title>{t("lists.page.title")}</title>
      </Helmet>

      <WideContainer ultraWide>
        <div className="rounded-[2rem] border border-white/10 bg-background-main/70 p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-type-logo/80">
                {t("lists.page.eyebrow")}
              </p>
              <Heading1 className="mb-0 mt-3 text-3xl md:text-4xl">
                {t("lists.page.title")}
              </Heading1>
              <p className="mt-3 max-w-2xl text-type-secondary">
                {t("lists.page.description")}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {/* <Button
                href="/discover"
                theme="secondary"
                padding="px-4 py-2 text-sm md:text-base"
              >
                {t("home.search.discover")}
              </Button> */}
              <Button
                theme="purple"
                padding="px-4 py-2 text-sm md:text-base"
                onClick={() => setShowCreateForm(true)}
              >
                {t("lists.actions.create")}
              </Button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <MetaPill>
              {lists.length === 1
                ? t("lists.page.summarySingular")
                : t("lists.page.summaryPlural", { count: lists.length })}
            </MetaPill>
            <MetaPill>
              {publicListCount === 1
                ? t("lists.page.publicCountSingular")
                : t("lists.page.publicCountPlural", { count: publicListCount })}
            </MetaPill>
          </div>
        </div>

        <div className="mt-8">
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
            <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
              <div className="xl:sticky xl:top-24 xl:self-start">
                <div className="rounded-[2rem] border border-white/10 bg-background-main/70 p-4">
                  <div className="relative">
                    <Icon
                      icon={Icons.SEARCH}
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-type-secondary"
                    />
                    <input
                      type="text"
                      value={listSearch}
                      onChange={(event) => setListSearch(event.target.value)}
                      placeholder={t("lists.page.searchPlaceholder")}
                      className="w-full rounded-full border border-white/10 bg-white/5 py-3 pl-11 pr-11 text-sm text-white outline-none transition-colors placeholder:text-type-secondary/70 focus:border-buttons-purple/60"
                    />
                    {listSearch ? (
                      <button
                        type="button"
                        onClick={() => setListSearch("")}
                        className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-type-secondary transition-colors hover:bg-white/10 hover:text-white"
                        aria-label={t("actions.cancel")}
                      >
                        <Icon icon={Icons.X} className="text-xs" />
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSortMode("recent")}
                      className={classNames(
                        "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        sortMode === "recent"
                          ? "bg-buttons-purple text-white"
                          : "bg-white/5 text-type-secondary hover:bg-white/10 hover:text-white",
                      )}
                    >
                      {t("lists.page.sortRecent")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortMode("alphabetical")}
                      className={classNames(
                        "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        sortMode === "alphabetical"
                          ? "bg-buttons-purple text-white"
                          : "bg-white/5 text-type-secondary hover:bg-white/10 hover:text-white",
                      )}
                    >
                      {t("lists.page.sortAlphabetical")}
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-3 xl:max-h-[calc(100vh-18rem)] xl:overflow-y-auto xl:pr-1 scrollbar-thin scrollbar-track-background-secondary scrollbar-thumb-type-secondary">
                  {hasSearchResults ? (
                    filteredLists.map((list) => {
                      const isSelected = list.id === selectedListId;

                      return (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => setSelectedListId(list.id)}
                          className={classNames(
                            "group w-full rounded-[1.75rem] border px-4 py-4 text-left transition-all duration-200",
                            isSelected
                              ? "border-buttons-purple bg-background-main shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                              : "border-white/10 bg-background-main/60 hover:border-white/20 hover:bg-background-main/80",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={classNames(
                                "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full transition-colors",
                                isSelected
                                  ? "bg-buttons-purple"
                                  : "bg-white/15 group-hover:bg-white/30",
                              )}
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-base font-semibold text-white">
                                    {list.name}
                                  </p>
                                  {list.description ? (
                                    <p className="mt-1 line-clamp-2 text-sm text-type-secondary">
                                      {list.description}
                                    </p>
                                  ) : null}
                                </div>
                                {isSelected ? (
                                  <Icon
                                    icon={Icons.CHEVRON_RIGHT}
                                    className="mt-0.5 shrink-0 text-sm text-type-logo"
                                  />
                                ) : null}
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-type-secondary">
                                <VisibilityBadge isPublic={list.public} />
                                <span className="rounded-full bg-white/5 px-2.5 py-1">
                                  {t("lists.meta.itemCount", {
                                    count: list.items.length,
                                  })}
                                </span>
                                <span>{formatShortDate(list.updatedAt)}</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-[1.75rem] border border-white/10 bg-background-main/60 px-5 py-10 text-center">
                      <p className="text-base font-medium text-white">
                        {t("lists.page.searchEmptyTitle")}
                      </p>
                      <p className="mt-2 text-sm text-type-secondary">
                        {t("lists.page.searchEmptyDescription")}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-background-main p-6 md:p-7">
                {!hasSearchResults ? (
                  <div className="flex min-h-[28rem] flex-col items-center justify-center text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-type-logo">
                      <Icon icon={Icons.SEARCH} className="text-lg" />
                    </div>
                    <p className="mt-4 text-xl text-white">
                      {t("lists.page.searchEmptyTitle")}
                    </p>
                    <p className="mt-2 max-w-md text-type-secondary">
                      {t("lists.page.searchEmptyDescription")}
                    </p>
                  </div>
                ) : selectedList ? (
                  <>
                    <div className="border-b border-white/10 pb-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 max-w-3xl">
                          <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-2xl font-semibold text-white md:text-3xl">
                              {selectedList.name}
                            </h2>
                            <VisibilityBadge isPublic={selectedList.public} />
                          </div>

                          {selectedList.description ? (
                            <p className="mt-3 text-type-secondary">
                              {selectedList.description}
                            </p>
                          ) : null}

                          <div className="mt-4 flex flex-wrap gap-3">
                            <MetaPill className="text-xs md:text-sm">
                              {t("lists.meta.itemCount", {
                                count: selectedList.items.length,
                              })}
                            </MetaPill>
                            <MetaPill className="text-xs md:text-sm">
                              {t("lists.meta.updatedAt", {
                                date: formatLongDate(selectedList.updatedAt),
                              })}
                            </MetaPill>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            theme={editingItems ? "purple" : "secondary"}
                            padding="px-3 py-2"
                            onClick={() => setEditingItems((prev) => !prev)}
                          >
                            {editingItems
                              ? t("home.mediaList.stopEditing")
                              : t("lists.actions.editItems")}
                          </Button>
                          <Button
                            theme="secondary"
                            padding="px-3 py-2"
                            onClick={() => setEditingList(selectedList)}
                          >
                            {t("lists.actions.edit")}
                          </Button>
                          {selectedList.public ? (
                            <Button
                              theme="secondary"
                              padding="px-3 py-2"
                              onClick={() => handleCopyShare(selectedList)}
                            >
                              {copiedListId === selectedList.id
                                ? t("actions.copied")
                                : t("lists.actions.copyShareLink")}
                            </Button>
                          ) : null}
                          <Button
                            theme="danger"
                            padding="px-3 py-2"
                            onClick={() => handleDeleteList(selectedList)}
                          >
                            {t("lists.actions.delete")}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6">
                      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-type-secondary">
                            {t("lists.page.itemsEyebrow")}
                          </p>
                          <p className="mt-2 text-sm text-type-secondary">
                            {editingItems
                              ? t("lists.page.editingHint")
                              : t("lists.page.itemsHint")}
                          </p>
                        </div>
                      </div>

                      {loadingItems ? (
                        <div className="flex min-h-[12rem] items-center justify-center">
                          <Spinner className="text-2xl text-white" />
                        </div>
                      ) : hydratedItems.length === 0 ? (
                        <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-background-main/60 px-6 py-12 text-center">
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-type-logo">
                            <Icon icon={Icons.PLUS} className="text-base" />
                          </div>
                          <p className="mt-4 text-lg text-white">
                            {t("lists.items.empty")}
                          </p>
                          <p className="mx-auto mt-2 max-w-md text-sm text-type-secondary">
                            {t("lists.items.emptyHelp")}
                          </p>
                          <Button
                            href="/discover"
                            theme="secondary"
                            className="mt-6"
                            padding="px-4 py-2"
                          >
                            {t("home.search.discoverMore")}
                          </Button>
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
        </div>
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
