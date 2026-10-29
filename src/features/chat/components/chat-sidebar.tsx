import { getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { joinChannelAction } from "@/features/chat/server/actions";
import type { ChannelView } from "@/features/chat/server/chat-service";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export async function ChatSidebar({
  organizationSlug,
  joined,
  available,
  activeId,
}: {
  organizationSlug: string;
  joined: ChannelView[];
  available: ChannelView[];
  activeId?: string;
}) {
  const t = await getTranslations("Chat");
  const channels = joined.filter((channel) => channel.type === "CHANNEL");
  const dms = joined.filter((channel) => channel.type === "DM");

  const list = (items: ChannelView[], prefix: string) => (
    <ul className="space-y-1">
      {items.map((channel) => (
        <li key={channel.id}>
          <Link
            href={`/w/${organizationSlug}/chat/${channel.id}`}
            aria-current={channel.id === activeId ? "page" : undefined}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
              channel.id === activeId && "bg-muted font-medium",
            )}
          >
            <span className="truncate">
              {prefix}
              {channel.name}
            </span>
            {channel.unread > 0 && (
              <span
                className="rounded-full bg-primary px-2 text-xs text-primary-foreground"
                aria-label={t("unread", { count: channel.unread })}
              >
                {channel.unread}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <aside aria-label={t("sidebarLabel")} className="space-y-6 md:w-60 md:shrink-0">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("channels")}</h2>
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noChannels")}</p>
        ) : (
          list(channels, "# ")
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("directMessages")}</h2>
        {dms.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noDms")}</p>
        ) : (
          list(dms, "")
        )}
      </section>
      {available.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("browse")}</h2>
          <ul className="space-y-2">
            {available.map((channel) => (
              <li key={channel.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-sm"># {channel.name}</span>
                <ActionButton
                  action={joinChannelAction}
                  fields={{ organizationSlug, channelId: channel.id }}
                  label={t("join")}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
