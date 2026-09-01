import { useServerFn } from "@tanstack/react-start";
import { Languages } from "lucide-react";
import { LANGUAGES, useTranslation, type Language } from "@/lib/i18n";
import { setMyLanguage } from "@/lib/language.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * App-language picker. Updates the client immediately (cookie + localStorage +
 * <html lang/dir>) and, for signed-in users, persists to their profile. The
 * profile write is best-effort — it 401s for signed-out visitors on /auth,
 * which is fine.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage, t } = useTranslation();
  const persist = useServerFn(setMyLanguage);

  function handleChange(next: string) {
    const lang = next as Language;
    setLanguage(lang);
    void persist({ data: lang }).catch(() => {
      // signed-out visitor, or a transient error — the cookie already carries it
    });
  }

  return (
    <div className={className}>
      <Select value={language} onValueChange={handleChange}>
        <SelectTrigger aria-label={t("language.label")} className="w-[190px] rounded-full bg-card">
          <Languages className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((entry) => (
            <SelectItem key={entry.code} value={entry.code}>
              {entry.nativeLabel}
              {entry.code !== "en" ? ` · ${entry.label}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {language !== "en" ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("language.reviewNotice")}</p>
      ) : null}
    </div>
  );
}
