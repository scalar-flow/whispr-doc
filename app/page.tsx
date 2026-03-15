"use client"

import { useState, useCallback } from "react"
import { AppHeader } from "@/components/app-header"
import { LayersPanel } from "@/components/layers-panel"
import { DocumentViewer } from "@/components/document-viewer"
import { DocumentAssistant } from "@/components/document-assistant"
import { DetectedField } from "@/lib/pdf-utils"

export default function WhisprDocPro() {
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [isAssistantOpen, setIsAssistantOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [fields, setFields] = useState<DetectedField[]>([])
  const [focusedFieldName, setFocusedFieldName] = useState<string | null>(null)
  const [lastRename, setLastRename] = useState<{ oldName: string, newName: string } | null>(null)

  const hasPdf = pdfFile !== null

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file) return
    setPdfFile(file)
    setCurrentPage(1)
    setTotalPages(0)
    setFocusedFieldName(null)
  }, [])

  const handleFieldClick = useCallback((fieldName: string, pageNumber: number) => {
    setCurrentPage(pageNumber)
    setFocusedFieldName(fieldName)
  }, [])

  const handleFieldRename = useCallback((oldName: string, newName: string) => {
    if (!newName || oldName === newName) return

    setFields(prev => prev.map(f => f.name === oldName ? { ...f, name: newName } : f))

    if (focusedFieldName === oldName) {
      setFocusedFieldName(newName)
    }

    setLastRename({ oldName, newName })
  }, [focusedFieldName])

  return (
    <div className="flex h-screen flex-col bg-background">
      <AppHeader />
      <div className="flex flex-1 overflow-hidden">
        <LayersPanel
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          totalPages={totalPages}
          hasPdf={hasPdf}
          fields={fields}
          focusedFieldName={focusedFieldName}
          onFieldClick={handleFieldClick}
          onFieldRename={handleFieldRename}
        />
        <DocumentViewer
          currentPage={currentPage}
          totalPages={totalPages}
          zoom={zoom}
          onZoomChange={setZoom}
          onPageChange={setCurrentPage}
          onTotalPagesChange={setTotalPages}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isAssistantOpen={isAssistantOpen}
          onToggleAssistant={() => setIsAssistantOpen(!isAssistantOpen)}
          pdfFile={pdfFile}
          onFileSelect={handleFileSelect}
          onReset={() => {
            setPdfFile(null)
            setFocusedFieldName(null)
          }}
          onFieldsChange={setFields}
          focusedFieldName={focusedFieldName}
          onFocusedFieldChange={setFocusedFieldName}
          onFieldRename={handleFieldRename}
          lastRename={lastRename}
        />
        {isAssistantOpen && (
          <DocumentAssistant onClose={() => setIsAssistantOpen(false)} hasPdf={hasPdf} />
        )}
      </div>
    </div>
  )
}
