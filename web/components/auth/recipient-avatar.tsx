"use client";

import { useState } from "react";

// Recipient avatar + details for the Send preview. For X/@handles we pull the
// profile picture from unavatar.io (no API key, resolves x/twitter avatars); for
// emails it resolves gravatar/favicon. Falls back to an initial on error.
function avatarUrl(recipient: string, kind: "handle" | "email"): string {
  const r = recipient.trim().replace(/^@+/, "");
  const base = kind === "handle"
    ? `https://unavatar.io/x/${encodeURIComponent(r)}`
    : `https://unavatar.io/${encodeURIComponent(r)}`;
  // unavatar `fallback=false` → 404 instead of a generic image, so onError fires.
  return `${base}?fallback=false`;
}

export function RecipientAvatar({
  recipient,
  kind,
}: {
  recipient: string;
  kind: "handle" | "email";
}) {
  const [broken, setBroken] = useState(false);
  const handle = recipient.trim().replace(/^@+/, "");
  const initial = (handle[0] || "?").toUpperCase();

  return (
    <div className="flex items-center gap-3">
      {broken ? (
        <div className="h-11 w-11 rounded-full bg-primary/15 border border-primary/30 grid place-items-center font-semibold text-primary">
          {initial}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl(recipient, kind)}
          alt={kind === "handle" ? `@${handle} on X` : recipient}
          width={44}
          height={44}
          onError={() => setBroken(true)}
          className="h-11 w-11 rounded-full object-cover border border-primary/30"
        />
      )}
      <div className="min-w-0">
        {kind === "handle" ? (
          <>
            <a
              href={`https://x.com/${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground hover:text-primary truncate block"
            >
              @{handle}
            </a>
            <span className="text-[11px] text-muted-foreground">X account · tap to view profile</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-foreground truncate block">{recipient}</span>
            <span className="text-[11px] text-muted-foreground">Email recipient</span>
          </>
        )}
      </div>
    </div>
  );
}
