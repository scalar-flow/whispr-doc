"use client"

import { TrendingUp } from "lucide-react"
import { CommentPopover } from "@/components/comment-popover"

interface DocumentContentProps {
  searchQuery: string
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return text

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
  const parts = text.split(regex)

  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="rounded bg-primary/30 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      part
    )
  )
}

export function DocumentContent({ searchQuery }: DocumentContentProps) {
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-border bg-background p-10 shadow-sm">
      {/* Header Section */}
      <div className="mb-8 border-b border-primary/20 pb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="mb-2 font-serif text-3xl font-bold text-foreground">
              {highlightText("Quarterly Strategic Report", searchQuery)}
            </h1>
            <p className="text-sm font-medium uppercase tracking-wider text-primary">
              {highlightText("INTERNAL RELEASE", searchQuery)} <span className="text-muted-foreground">•</span>{" "}
              <span className="text-primary">{highlightText("FY2024-Q3", searchQuery)}</span>
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
        </div>
      </div>

      {/* Executive Summary */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-bold text-foreground">
          {highlightText("1. Executive Summary", searchQuery)}
        </h2>
        <div className="relative">
          <p className="mb-4 leading-relaxed text-foreground">
            {highlightText(
              "The focus of this quarter has been accelerating our transition to cloud-native architectures. The infrastructure team has successfully migrated 65% of legacy assets, resulting in a ",
              searchQuery
            )}
            <span className="font-semibold text-primary underline decoration-primary/50 decoration-2 underline-offset-2">
              {highlightText("22% reduction in operational overhead", searchQuery)}
            </span>
            {highlightText(
              ". This report outlines the technical milestones achieved and strategic recommendations for the final integration phase.",
              searchQuery
            )}
          </p>
          <CommentPopover />
        </div>

        {/* Stats Cards */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Growth Index
            </p>
            <p className="text-2xl font-bold text-foreground">+14.2%</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
              <div className="h-full w-3/4 rounded-full bg-primary" />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Retention Rate
            </p>
            <p className="text-2xl font-bold text-foreground">98.5%</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
              <div className="h-full w-[98%] rounded-full bg-chart-2" />
            </div>
          </div>
        </div>
      </section>

      {/* Key Performance Indicators */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-bold text-foreground">
          {highlightText("2. Key Performance Indicators", searchQuery)}
        </h2>
        <p className="leading-relaxed text-foreground">
          {highlightText(
            "Analysis of market trends indicates a significant shift towards AI-driven insights. Our current trajectory aligns with these findings. We anticipate that by the end of next fiscal year, over 40% of our user interactions will be facilitated by the new automated assistant framework currently in beta.",
            searchQuery
          )}
        </p>
      </section>

      {/* Chart Placeholder */}
      <div className="aspect-video rounded-lg bg-muted/50 p-4">
        <div className="flex h-full items-end justify-center gap-4 px-8 pb-8">
          {[65, 45, 78, 52, 88, 70, 55, 90, 60, 75, 82, 68].map((height, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <div
                className="w-full rounded-t bg-primary/80 transition-all hover:bg-primary"
                style={{ height: `${height}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
