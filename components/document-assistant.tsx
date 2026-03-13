"use client"

import { useState } from "react"
import { X, Sparkles, Copy, ThumbsUp, ThumbsDown, ArrowUp, AudioLines, MessageCircle } from "lucide-react"

interface DocumentAssistantProps {
  onClose: () => void
  hasPdf: boolean
}

interface Message {
  id: number
  role: "assistant" | "user"
  content: string
  time: string
}

export function DocumentAssistant({ onClose, hasPdf }: DocumentAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")

  const handleSendMessage = () => {
    if (!inputValue.trim()) return

    const now = new Date()
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })

    const userMessage: Message = {
      id: Date.now(),
      role: "user",
      content: inputValue.trim(),
      time: timeStr,
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")

    // Simulate AI response
    setTimeout(() => {
      const assistantMessage: Message = {
        id: Date.now() + 1,
        role: "assistant",
        content: "I'm analyzing your request. This is a placeholder response - connect to an AI service for real responses.",
        time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      }
      setMessages((prev) => [...prev, assistantMessage])
    }, 1000)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <aside className="flex w-80 flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium text-foreground">Document Assistant</span>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages or Empty State */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 rounded-full bg-zinc-100 p-4">
              <MessageCircle className="h-8 w-8 text-zinc-400" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {hasPdf ? "Start a conversation" : "No document loaded"}
            </p>
            <p className="mt-1 max-w-[200px] text-xs text-muted-foreground">
              {hasPdf
                ? "Ask questions about your document to get AI-powered insights"
                : "Upload a PDF document to start asking questions"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id}>
                {message.role === "assistant" ? (
                  <div className="space-y-2">
                    <div className="rounded-lg bg-muted p-3">
                      <p className="whitespace-pre-line text-sm text-foreground">
                        {message.content}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </button>
                        <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        AI Assistant • {message.time}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2">
                      <p className="text-sm text-primary-foreground">{message.content}</p>
                    </div>
                    <p className="text-right text-xs text-muted-foreground">
                      You • {message.time}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about this doc..."
            disabled={!hasPdf}
            className="w-full rounded-full border border-border bg-muted/50 py-2.5 pl-4 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            disabled={!hasPdf}
            onClick={handleSendMessage}
            className={`absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              inputValue.trim()
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {inputValue.trim() ? (
              <ArrowUp className="h-4 w-4" />
            ) : (
              <AudioLines className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          AI may generate inaccurate information.
        </p>
      </div>
    </aside>
  )
}
