//pdf-utils.ts:
import {
  PDFDocument,
  PDFName,
  PDFRadioGroup,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  StandardFonts,
  rgb,
  PDFSignature,
  PDFHexString,
  PDFString
} from "pdf-lib"
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib"

export type DetectionMode = 'auto' | 'text' | 'multiline' | 'checkbox' | 'radio' | 'signature' | 'date' | 'dropdown'

export const SIGNATURE_REGEX = /e-?sign|esign|sig(nature)?|sign\s*(here|under|above)/i
export const DATE_REGEX = /\b(d\.?\s*o\.?\s*b\.?|date\s*of\s*birth|birth\s*date|d\/o\/b|dob|date\s*(signed)?|signed\s*date)\b(?=\s*:|\s*$)/i

export interface DetectedField {
  name: string
  type: DetectionMode
  options?: string[] // For dropdown fields
  rect?: {
    x: number
    y: number
    width: number
    height: number
    pageIndex: number
  }
  paddingTop?: number
  fontSize?: number
}

export interface AutofilledFieldState {
  fieldName: string
  type: DetectionMode
  value: string | boolean
  accepted: boolean
}

export async function detectFormFields(pdfBytes: ArrayBuffer): Promise<DetectedField[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const form = pdfDoc.getForm()
  const fields = form.getFields()
  const pages = pdfDoc.getPages()

  const detectedFields: DetectedField[] = []

  for (const field of fields) {
    const name = field.getName()

    let rect: DetectedField["rect"] = undefined
    try {
      const widgets = field.acroField.getWidgets()
      if (widgets.length > 0) {
        const widget = widgets[0]
        const widgetRect = widget.getRectangle()

        let pageIndex = 0
        for (let i = 0; i < pages.length; i++) {
          const pageRef = pages[i].ref
          const parentRef = widget.P()
          if (parentRef && pageRef.toString() === parentRef.toString()) {
            pageIndex = i
            break
          }
        }

        const page = pages[pageIndex]
        const { height: pageHeight } = page.getSize()

        rect = {
          x: widgetRect.x,
          y: pageHeight - widgetRect.y - widgetRect.height,
          width: widgetRect.width,
          height: widgetRect.height,
          pageIndex,
        }
      }
    } catch (e) {
      // Field position extraction failed
    }

    if (field instanceof PDFTextField) {
      const isMultiline = field.isMultiline()

      const isDateText = DATE_REGEX.test(name);
      detectedFields.push({
        name,
        type: isDateText ? "date" : (isMultiline ? "multiline" : "text"),
        rect,
      })
    } else if (field instanceof PDFCheckBox) {
      detectedFields.push({
        name,
        type: "checkbox",
        rect,
      })
    } else if (field instanceof PDFDropdown) {
      const options = field.getOptions()
      detectedFields.push({
        name,
        type: "dropdown",
        options,
        rect,
      })
    } else if (field instanceof PDFRadioGroup) {
      detectedFields.push({
        name,
        type: "radio",
        options: field.getOptions(),
        rect, // Warning: This rect is only for the first button in the group
      })
    } else if (field instanceof PDFSignature) {
      detectedFields.push({
        name,
        type: "signature",
        rect,
      })
    } else {
      detectedFields.push({
        name,
        type: "text",
        rect,
      })
    }
  }

  return detectedFields
}

export async function fillPdfFields(
  pdfBytes: ArrayBuffer,
  data: Record<string, string | boolean>,
  detectedFields: DetectedField[] = []
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const form = pdfDoc.getForm()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()

  for (const [fieldName, value] of Object.entries(data)) {
    const fieldInfo = detectedFields.find((f) => f.name === fieldName)

    if (fieldInfo?.rect) {
      const { pageIndex, x, y, width, height } = fieldInfo.rect
      if (pageIndex >= pages.length) continue

      const page = pages[pageIndex]
      const { height: pageHeight } = page.getSize()
      const pdfY = pageHeight - y - height

      if (fieldInfo.type === "checkbox" || fieldInfo.type === "radio") {
        const isChecked = value === true

        page.drawRectangle({
          x: x,
          y: pdfY,
          width: width,
          height: height,
          color: rgb(1, 1, 1), // White
        })

        if (fieldInfo.type === "checkbox") {
          page.drawRectangle({
            x: x,
            y: pdfY,
            width: width,
            height: height,
            borderColor: rgb(0, 0, 0),
            borderWidth: 1,
            color: rgb(1, 1, 1), // Transparent/White background
          })

          if (isChecked) {
            const padding = Math.min(width, height) * 0.2
            page.drawLine({
              start: { x: x + padding, y: pdfY + padding },
              end: { x: x + width - padding, y: pdfY + height - padding },
              thickness: 2,
              color: rgb(0, 0, 0),
            })
            page.drawLine({
              start: { x: x + width - padding, y: pdfY + padding },
              end: { x: x + padding, y: pdfY + height - padding },
              thickness: 2,
              color: rgb(0, 0, 0),
            })
          }

          try {
            const field = form.getField(fieldName)
            if (field instanceof PDFCheckBox) field.uncheck()
          } catch (e) { }
        }
        else if (fieldInfo.type === "radio") {
          const rx = width / 2
          const ry = height / 2
          const cx = x + rx
          const cy = pdfY + ry

          page.drawEllipse({
            x: cx,
            y: cy,
            xScale: rx,
            yScale: ry,
            borderColor: rgb(0, 0, 0),
            borderWidth: 1,
            color: rgb(1, 1, 1),
          })

          if (isChecked) {
            page.drawEllipse({
              x: cx,
              y: cy,
              xScale: rx * 0.6,
              yScale: ry * 0.6,
              color: rgb(0, 0, 0),
            })
          }
        }
      }

      else if (fieldInfo.type === "signature" && typeof value === "string" && value.startsWith("data:image")) {
        try {
          const image = await pdfDoc.embedPng(value)

          const paddingTop = fieldInfo.paddingTop || 0
          const effectiveHeight = Math.max(0, height - paddingTop)

          const dims = image.scaleToFit(width, effectiveHeight)
          const xOffset = (width - dims.width) / 2
          const yOffset = (effectiveHeight - dims.height) / 2

          page.drawImage(image, {
            x: x + xOffset,
            y: pdfY + yOffset,
            width: dims.width,
            height: dims.height,
          })
        } catch (e) {
          console.error(`Failed to embed signature for ${fieldName}`, e)
        }
      }

      else if ((typeof value === "string" && value) || fieldInfo.type === 'date') {
        const textValue = String(value)
        const isMultiline = fieldInfo.type === "multiline"

        if (isMultiline) {
          const fontSize = fieldInfo.fontSize || 12
          const lineHeight = fontSize * 1.2
          const padX = 4
          const paddingTop = fieldInfo.paddingTop ?? 2

          const maxWidth = width - (padX * 2)

          const measureWidth = (text: string) => font.widthOfTextAtSize(text, fontSize)

          const paragraphs = textValue.split('\n')
          const lines: string[] = []

          for (const paragraph of paragraphs) {
            const words = paragraph.split(' ')
            let currentLine = ""

            for (let i = 0; i < words.length; i++) {
              const word = words[i]
              const separator = currentLine.length > 0 ? " " : ""
              const testLine = currentLine + separator + word

              if (measureWidth(testLine) <= maxWidth) {
                currentLine = testLine
              } else {
                if (currentLine.length > 0) {
                  lines.push(currentLine)
                  currentLine = ""
                }

                if (measureWidth(word) <= maxWidth) {
                  currentLine = word
                } else {
                  let partialWord = ""
                  for (const char of word) {
                    if (measureWidth(partialWord + char) <= maxWidth) {
                      partialWord += char
                    } else {
                      lines.push(partialWord)
                      partialWord = char
                    }
                  }
                  currentLine = partialWord
                }
              }
            }
            if (currentLine) {
              lines.push(currentLine)
            }
          }

          let currentY = pdfY + height - paddingTop - fontSize

          for (const line of lines) {
            if (currentY < pdfY) break;

            page.drawText(line, {
              x: x + padX,
              y: currentY,
              size: fontSize,
              font: font,
              color: rgb(0, 0, 0),
            })

            currentY -= lineHeight
          }
        } else {
          let fontSize = fieldInfo.fontSize;

          if (!fontSize) {
            fontSize = Math.max(6, height * 0.75)
            const textWidth = font.widthOfTextAtSize(textValue, fontSize)
            const availableWidth = width - 8
            if (textWidth > availableWidth) {
              const scaleFactor = availableWidth / textWidth
              fontSize = Math.max(6, fontSize * scaleFactor)
            }
          }

          const vOffset = (height - fontSize) / 2 + (fontSize / 6)

          page.drawText(textValue, {
            x: x + 4,
            y: pdfY + vOffset,
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
          })
        }

        try {
          const field = form.getField(fieldName)
          if (field instanceof PDFTextField) {
            field.setText("")
          }
        } catch (e) { }
      }

    } else {
      // Fallback
      try {
        const field = form.getField(fieldName)
        if (field instanceof PDFTextField) {
          field.setText(String(value || ""))
        } else if (field instanceof PDFCheckBox && typeof value === "boolean") {
          if (value) field.check()
          else field.uncheck()
        } else if (field instanceof PDFDropdown && typeof value === "string") {
          field.select(value)
        }
      } catch (e) { }
    }
  }

  return pdfDoc.save()
}

export async function generateEmptyAcroForm(
  pdfBytes: ArrayBuffer,
  fields: DetectedField[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const form = pdfDoc.getForm()
  const pages = pdfDoc.getPages()

  const context = pdfDoc.context

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const createdFields = new Set<string>()

  for (const field of fields) {
    if (!field.rect || createdFields.has(field.name)) continue

    const { x, y, width, height, pageIndex } = field.rect
    if (pageIndex >= pages.length) continue

    const page = pages[pageIndex]
    const { height: pageHeight } = page.getSize()

    const pdfBottomY = pageHeight - y - height

    let finalHeight = height

    if (field.type === "multiline" || field.type === "text" || field.type === "date") {
      if (field.paddingTop && field.paddingTop > 0) {
        finalHeight = Math.max(12, height - (field.paddingTop + 3))
      }
    }

    const widgetRect = { x, y: pdfBottomY, width, height: finalHeight }

    try {
      if (field.type === "checkbox") {
        let checkBox = tryGetField(form, field.name) as PDFCheckBox
        if (!checkBox) checkBox = form.createCheckBox(field.name)
        checkBox.addToPage(page, widgetRect)
      }
      else if (field.type === "radio") {
        let radioGroup = tryGetField(form, field.name) as PDFRadioGroup
        if (!radioGroup) radioGroup = form.createRadioGroup(field.name)
        radioGroup.addOptionToPage(field.name + "_opt", page, widgetRect)
      }
      else if (field.type === "signature") {
        // Create a raw dictionary for an EMPTY signature field
        const signatureDict = context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          FT: 'Sig',
          Rect: [x, pdfBottomY, x + width, pdfBottomY + finalHeight], // [x1, y1, x2, y2]
          T: PDFString.of(field.name), // The Field Name
          F: 4, // Flags: 4 = Print. This ensures it's visible/printable.
          P: page.ref, // Link to the page
          // IMPORTANT: Do NOT set 'V'. Presence of 'V' implies it is already signed.
        })

        // Register the dictionary as a reference in the PDF
        const signatureRef = context.register(signatureDict)

        // 1. Add the annotation to the Page
        page.node.addAnnot(signatureRef)

        // 2. Add the field to the AcroForm
        // We need to access the low-level AcroForm object
        const acroForm = pdfDoc.catalog.getOrCreateAcroForm()
        acroForm.addField(signatureRef)
      }
      else {
        let textField = tryGetField(form, field.name) as PDFTextField
        if (!textField) textField = form.createTextField(field.name)

        textField.addToPage(page, widgetRect)

        textField.updateAppearances(font)
        textField.setFontSize(14)

        if (field.type === "multiline" || height > 50) {
          textField.enableMultiline()
        } else {
          textField.disableMultiline()
        }
      }

      createdFields.add(field.name)

    } catch (e) {
      console.warn(`Failed to create AcroForm field: ${field.name}`, e)
    }
  }

  return pdfDoc.save()
}

function tryGetField(form: any, name: string) {
  try {
    return form.getField(name)
  } catch (err) {
    return null
  }
}