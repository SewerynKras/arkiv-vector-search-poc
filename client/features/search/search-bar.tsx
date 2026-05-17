"use client"

// The search input + run button. Controlled from the parent so the parent
// also owns the k/nprobe options and can imperatively focus the input when
// the user clicks an example chip.

import { useRef, useImperativeHandle, type Ref } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export interface SearchBarHandle {
  setQuery: (q: string) => void
  focus: () => void
}

export interface SearchBarProps {
  ref?: Ref<SearchBarHandle>
  disabled?: boolean
  loading?: boolean
  onSubmit: (q: string) => void
  placeholder?: string
}

export function SearchBar({
  ref,
  disabled,
  loading,
  onSubmit,
  placeholder = "Ask anything in plain English…",
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    setQuery: (q: string) => {
      if (inputRef.current) {
        inputRef.current.value = q
        inputRef.current.focus()
      }
    },
    focus: () => inputRef.current?.focus(),
  }))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const q = inputRef.current?.value.trim()
        if (q) onSubmit(q)
      }}
      className="flex items-stretch gap-2.5"
    >
      <Input
        ref={inputRef}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        className="h-12 rounded-sm px-4 !text-base"
      />
      <Button
        type="submit"
        disabled={disabled || loading}
        className="h-12 rounded-sm px-6 text-sm"
      >
        {loading ? "Searching…" : "Search"}
      </Button>
    </form>
  )
}
