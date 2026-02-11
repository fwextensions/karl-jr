import React from 'react'
import { Card } from './Card'
import type { Translation } from '@sf-gov/shared'
import { OpenIcon } from "@/sidepanel/icons/OpenIcon.tsx";

interface TranslationsCardProps {
  translations: Translation[]
}

export const TranslationsCard: React.FC<TranslationsCardProps> = ({ translations }) => {
  if (translations.length === 0) {
    return (
      <Card title="Translations">
        <p className="text-sm text-gray-500 italic">No translations available</p>
      </Card>
    )
  }

  return (
    <Card title="Translations" collapsible>
      <ul className="space-y-2">
        {translations.map((translation) => (
          <li key={translation.pageId} className="flex items-center gap-3">
            <span className="inline-block px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded uppercase">
              {translation.languageCode}
            </span>
            <a
              href={translation.editUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm flex-1"
            >
              {translation.title}
            </a>
            <OpenIcon className="w-4 h-4 text-gray-400" aria-hidden="true" />
          </li>
        ))}
      </ul>
    </Card>
  )
}
