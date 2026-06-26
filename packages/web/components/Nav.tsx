"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/tailor", label: "Tailor" },
  { href: "/resume/master", label: "Master Resume" },
  { href: "/applied", label: "Applied" },
];

export default function Nav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <nav className="border-b border-zinc-200 bg-white px-6 py-3 flex items-center gap-1">
      <span className="font-semibold text-zinc-900 mr-5 text-sm tracking-tight">
        Job Agent
      </span>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
            isActive(href)
              ? "bg-zinc-100 text-zinc-900 font-medium"
              : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
