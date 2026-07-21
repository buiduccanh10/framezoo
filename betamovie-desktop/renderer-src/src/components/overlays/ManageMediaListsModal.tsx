import classNames from "classnames";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CreateListInput } from "@/backend/accounts/lists";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import {
  ListFormModal,
  ListFormValues,
} from "@/components/overlays/ListFormModal";
import { ModalCard } from "@/components/overlays/Modal";
import { OverlayPortal } from "@/components/overlays/OverlayDisplay";
import { useAccountLists } from "@/hooks/lists/useAccountLists";
import { buildListMembershipUpdates } from "@/stores/lists/utils";

interface ManageMediaListsModalProps {
  open: boolean;
  onClose: () => void;
  media: {
    tmdbId: string;
    title: string;
    type: "movie" | "show";
  };
}

function formatListItemType(type: "movie" | "show"): "movie" | "tv" {
  return type === "show" ? "tv" : "movie";
}

export function ManageMediaListsModal({
  open,
  onClose,
  media,
}: ManageMediaListsModalProps) {
  const { t } = useTranslation();
  const { lists, reloadLists, updateListAndStore, createListAndStore } =
    useAccountLists();
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentMembershipIds = useMemo(
    () =>
      lists
        .filter((list) =>
          list.items.some((item) => item.tmdbId === media.tmdbId),
        )
        .map((list) => list.id),
    [lists, media.tmdbId],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedListIds(currentMembershipIds);
    setError(null);
  }, [currentMembershipIds, open]);

  const toggleList = (listId: string) => {
    setSelectedListIds((prev) =>
      prev.includes(listId)
        ? prev.filter((value) => value !== listId)
        : [...prev, listId],
    );
  };

  const handleSave = async () => {
    const updates = buildListMembershipUpdates(
      lists,
      media.tmdbId,
      formatListItemType(media.type),
      selectedListIds,
    );

    if (updates.length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await Promise.all(updates.map((update) => updateListAndStore(update)));
      await reloadLists();
      onClose();
    } catch (saveError) {
      console.error("Failed to update list membership", saveError);
      setError(t("lists.modal.errors.save"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateList = async (values: ListFormValues) => {
    setIsSaving(true);
    setError(null);

    const input: CreateListInput = {
      name: values.name,
      description: values.description || null,
      public: values.public,
      items: [
        {
          tmdb_id: media.tmdbId,
          type: formatListItemType(media.type),
        },
      ],
    };

    try {
      await createListAndStore(input);
      await reloadLists();
      setShowCreateForm(false);
      onClose();
    } catch (createError) {
      console.error("Failed to create list", createError);
      setError(t("lists.modal.errors.create"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <OverlayPortal darken show={open} close={onClose} zIndex={1100}>
        <div className="flex absolute inset-0 items-center justify-center">
          <ModalCard className="!max-w-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {t("lists.modal.title")}
                </h2>
                <p className="mt-2 text-sm text-type-secondary">
                  {t("lists.modal.description", { title: media.title })}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-type-secondary transition-colors hover:bg-background-main hover:text-white"
                aria-label={t("actions.cancel")}
              >
                <Icon icon={Icons.X} />
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {lists.length === 0 ? (
                <div className="rounded-xl bg-background-main px-4 py-8 text-center">
                  <p className="text-white">{t("lists.modal.empty.title")}</p>
                  <p className="mt-2 text-sm text-type-secondary">
                    {t("lists.modal.empty.description")}
                  </p>
                  <Button
                    theme="purple"
                    className="mt-4"
                    onClick={() => setShowCreateForm(true)}
                  >
                    {t("lists.modal.actions.create")}
                  </Button>
                </div>
              ) : (
                lists.map((list) => {
                  const checked = selectedListIds.includes(list.id);
                  return (
                    <button
                      key={list.id}
                      type="button"
                      onClick={() => toggleList(list.id)}
                      className={classNames(
                        "flex w-full items-start gap-3 rounded-xl border px-4 py-4 text-left transition-colors",
                        checked
                          ? "border-buttons-purple bg-buttons-purple/10"
                          : "border-transparent bg-background-main hover:border-white/10",
                      )}
                    >
                      <div
                        className={classNames(
                          "mt-1 flex h-5 w-5 items-center justify-center rounded border",
                          checked
                            ? "border-buttons-purple bg-buttons-purple text-white"
                            : "border-white/20 text-transparent",
                        )}
                      >
                        <Icon icon={Icons.CHECKMARK} className="text-[10px]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-white">
                            {list.name}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">
                            <Icon
                              icon={list.public ? Icons.UNLOCK : Icons.LOCK}
                              className="text-[10px]"
                            />
                            {list.public
                              ? t("lists.visibility.public")
                              : t("lists.visibility.private")}
                          </span>
                        </div>
                        {list.description ? (
                          <p className="mt-1 line-clamp-2 text-sm text-type-secondary">
                            {list.description}
                          </p>
                        ) : null}
                        <p className="mt-2 text-xs text-type-secondary">
                          {t("lists.meta.itemCount", {
                            count: list.items.length,
                          })}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {error ? (
              <p className="mt-4 text-sm text-type-danger">{error}</p>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-between gap-3">
              {lists.length > 0 ? (
                <Button
                  theme="secondary"
                  onClick={() => setShowCreateForm(true)}
                  disabled={isSaving}
                >
                  {t("lists.modal.actions.create")}
                </Button>
              ) : (
                <div />
              )}
              <div className="flex gap-3">
                <Button theme="secondary" onClick={onClose} disabled={isSaving}>
                  {t("lists.modal.actions.cancel")}
                </Button>
                {lists.length > 0 ? (
                  <Button
                    theme="purple"
                    onClick={handleSave}
                    loading={isSaving}
                  >
                    {t("lists.modal.actions.save")}
                  </Button>
                ) : null}
              </div>
            </div>
          </ModalCard>
        </div>
      </OverlayPortal>

      <ListFormModal
        open={showCreateForm}
        title={t("lists.form.createTitle")}
        description={t("lists.form.createDescription")}
        submitLabel={t("lists.modal.actions.create")}
        loading={isSaving}
        onClose={() => setShowCreateForm(false)}
        onSubmit={handleCreateList}
      />
    </>
  );
}
