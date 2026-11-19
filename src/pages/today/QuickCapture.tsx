import type { RefObject } from "react";
import { Plus } from "lucide-react";
import { useT } from "../../lib/i18n";
import { Btn } from "../../ui";
import type { Project } from "../../types";

export function QuickCapture({
  inputRef,
  title,
  onTitle,
  project,
  onProject,
  projects,
  onSubmit,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  title: string;
  onTitle: (v: string) => void;
  project: string;
  onProject: (v: string) => void;
  projects: Project[];
  onSubmit: () => void;
}) {
  const t = useT();
  return (
    <form
      className="flex flex-col gap-1.5 rounded-[calc(var(--radius-card)+2px)] border border-line/80 bg-panel px-2 py-2 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.5)] transition-colors focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10 sm:flex-row sm:items-center sm:rounded-full"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-2">
        <Plus size={16} className="shrink-0 text-accent" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-text outline-none placeholder:text-faint"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder={t("today.quickPlaceholder")}
          aria-label={t("today.quickPlaceholder")}
        />
      </div>
      <select
        className="rounded-[var(--radius-btn)] border border-line bg-panel2 px-2 py-1.5 text-xs text-text outline-none sm:w-40 sm:border-0 sm:border-l sm:bg-transparent sm:pl-3"
        value={project}
        onChange={(e) => onProject(e.target.value)}
        aria-label={t("today.quickProject")}
      >
        <option value="">{t("today.inboxOption")}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Btn variant="primary" type="submit" className="shrink-0 sm:!rounded-full">
        {t("today.quickAdd")}
      </Btn>
    </form>
  );
}
