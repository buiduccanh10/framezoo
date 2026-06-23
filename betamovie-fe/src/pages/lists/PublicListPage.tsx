import { ReactNode, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { getPublicList, hydrateListItems } from "@/backend/accounts/lists";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { Spinner } from "@/components/layout/Spinner";
import { WideContainer } from "@/components/layout/WideContainer";
import { MediaGrid } from "@/components/media/MediaGrid";
import { WatchedMediaCard } from "@/components/media/WatchedMediaCard";
import { Heading1 } from "@/components/utils/Text";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { SubPageLayout } from "@/pages/layouts/SubPageLayout";
import { HydratedListItem, StoredList } from "@/stores/lists";

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

function MetaPill(props: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-sm text-white/80">
      {props.children}
    </span>
  );
}

export function PublicListPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const backendUrl = useBackendUrl();
  const [list, setList] = useState<StoredList | null>(null);
  const [items, setItems] = useState<HydratedListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusCode, setStatusCode] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!backendUrl || !id) {
        setStatusCode(404);
        setLoading(false);
        return;
      }

      setLoading(true);
      setStatusCode(null);
      setList(null);
      setItems([]);

      try {
        const nextList = await getPublicList(backendUrl, id);
        const hydratedItems = await hydrateListItems(nextList.items);

        if (!cancelled) {
          setList(nextList);
          setItems(hydratedItems);
        }
      } catch (error: any) {
        if (!cancelled) {
          setStatusCode(
            error?.response?.status ??
              error?.status ??
              error?.statusCode ??
              500,
          );
          setList(null);
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [backendUrl, id]);

  const title = list?.name ?? t("lists.public.pageTitle");

  return (
    <SubPageLayout>
      <Helmet>
        <title>{title}</title>
      </Helmet>

      <WideContainer ultraWide>
        {loading ? (
          <div className="flex min-h-[20rem] items-center justify-center">
            <Spinner className="text-2xl text-white" />
          </div>
        ) : !list ? (
          <div className="rounded-3xl bg-background-main/70 px-8 py-16 text-center">
            <p className="text-xl text-white">
              {statusCode === 403
                ? t("lists.public.privateTitle")
                : t("lists.public.notFoundTitle")}
            </p>
            <p className="mx-auto mt-3 max-w-xl text-type-secondary">
              {statusCode === 403
                ? t("lists.public.privateDescription")
                : t("lists.public.notFoundDescription")}
            </p>
            <Button href="/discover" theme="purple" className="mt-6">
              {t("notFound.goHome")}
            </Button>
          </div>
        ) : (
          <>
            <div className="rounded-[2rem] border border-white/10 bg-background-main p-6 md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-type-logo/80">
                    {t("lists.public.pageTitle")}
                  </p>
                  <Heading1 className="mb-0 mt-3 text-3xl md:text-4xl">
                    {list.name}
                  </Heading1>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <VisibilityBadge isPublic={list.public} />
                    <MetaPill>
                      {t("lists.meta.itemCount", { count: list.items.length })}
                    </MetaPill>
                    <MetaPill>
                      {t("lists.meta.updatedAt", {
                        date: formatLongDate(list.updatedAt),
                      })}
                    </MetaPill>
                  </div>

                  <p className="mt-4 max-w-3xl text-type-secondary">
                    {list.description || t("lists.public.descriptionFallback")}
                  </p>
                </div>

                <Button
                  href="/discover"
                  theme="secondary"
                  padding="px-4 py-2 text-sm md:text-base"
                >
                  {t("home.search.discover")}
                </Button>
              </div>
            </div>

            <div className="mt-8">
              {items.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-background-main/60 px-6 py-12 text-center text-type-secondary">
                  {t("lists.items.empty")}
                </div>
              ) : (
                <MediaGrid>
                  {items.map((item) => (
                    <WatchedMediaCard
                      key={item.ref.id}
                      media={item.media}
                      linkable={item.canShowDetails}
                    />
                  ))}
                </MediaGrid>
              )}
            </div>
          </>
        )}
      </WideContainer>
    </SubPageLayout>
  );
}
