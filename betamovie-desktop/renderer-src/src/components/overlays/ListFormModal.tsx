import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { ModalCard } from "@/components/overlays/Modal";
import { OverlayPortal } from "@/components/overlays/OverlayDisplay";
import { Heading2, Paragraph } from "@/components/utils/Text";

export interface ListFormValues {
  name: string;
  description: string;
  public: boolean;
}

interface ListFormModalProps {
  open: boolean;
  title: string;
  description?: string;
  submitLabel: string;
  initialValue?: Partial<ListFormValues>;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (values: ListFormValues) => Promise<void> | void;
}

const defaultValues: ListFormValues = {
  name: "",
  description: "",
  public: false,
};

export function ListFormModal({
  open,
  title,
  description,
  submitLabel,
  initialValue,
  loading = false,
  onClose,
  onSubmit,
}: ListFormModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<ListFormValues>(defaultValues);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues({
      ...defaultValues,
      ...initialValue,
      description: initialValue?.description ?? "",
      public: initialValue?.public ?? false,
    });
    setError(null);
  }, [initialValue, open]);

  const handleSubmit = async () => {
    const name = values.name.trim();
    if (!name) {
      setError(t("lists.form.errors.nameRequired"));
      return;
    }

    setError(null);

    try {
      await onSubmit({
        ...values,
        name,
        description: values.description.trim(),
      });
    } catch (submitError) {
      console.error("Failed to submit list form", submitError);
      setError(t("lists.form.errors.submitFailed"));
    }
  };

  return (
    <OverlayPortal darken show={open} close={onClose} zIndex={1110}>
      <div className="flex absolute inset-0 items-center justify-center">
        <ModalCard className="!max-w-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Heading2 className="!my-0">{title}</Heading2>
              {description ? (
                <Paragraph className="mt-3 mb-0">{description}</Paragraph>
              ) : null}
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

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-white">
                {t("lists.form.name")}
              </label>
              <input
                type="text"
                value={values.name}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder={t("lists.form.namePlaceholder")}
                className="w-full rounded-lg bg-background-main px-3 py-2 text-sm text-white outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-white">
                {t("lists.form.description")}
              </label>
              <textarea
                value={values.description}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder={t("lists.form.descriptionPlaceholder")}
                rows={4}
                className="w-full rounded-lg bg-background-main px-3 py-2 text-sm text-white outline-none"
              />
              <p className="mt-2 text-xs text-type-secondary">
                {t("lists.form.descriptionHelp")}
              </p>
            </div>

            <label className="flex items-center gap-3 rounded-lg bg-background-main px-3 py-3 text-sm text-white">
              <input
                type="checkbox"
                checked={values.public}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    public: event.target.checked,
                  }))
                }
                className="h-4 w-4"
              />
              <div>
                <div className="font-medium">{t("lists.form.public")}</div>
                <div className="text-xs text-type-secondary">
                  {t("lists.form.publicHelp")}
                </div>
              </div>
            </label>

            {error ? <p className="text-sm text-type-danger">{error}</p> : null}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button theme="secondary" onClick={onClose}>
              {t("actions.cancel")}
            </Button>
            <Button theme="purple" onClick={handleSubmit} loading={loading}>
              {submitLabel}
            </Button>
          </div>
        </ModalCard>
      </div>
    </OverlayPortal>
  );
}
