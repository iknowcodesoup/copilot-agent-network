"use client";

import { Button } from "@/components/ui/button";
import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/videos", label: "Videos" },
  { href: "/voices", label: "Voices" },
] as const;

/*
 * Shared nav for the two dashboard views. Rendered once from the root
 * layout, above {children}, so it persists across navigations the same way
 * ChatSidebar does - a route change here must never remount the chat.
 */
export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex w-full max-w-5xl gap-1 px-6 pt-4">
      {NAV_ITEMS.map((item) => {
        const active = pathname !== null && pathname === item.href;
        return (
          <Button
            key={item.href}
            variant={active ? "secondary" : "ghost"}
            size="sm"
            render={<Link href={item.href} aria-current={active ? "page" : undefined} />}
          >
            {item.label}
          </Button>
        );
      })}
    </nav>
  );
}
