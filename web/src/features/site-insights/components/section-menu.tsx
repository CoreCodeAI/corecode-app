/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { ListTree } from 'lucide-react'
import { useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { readSections, type Section } from './sections'

/**
 * A menu of the open tab's panels that scrolls to the one picked, so a long
 * tab is crossed in one click. The panels are read from the page when the
 * menu opens: a tab lists what it shows now, with no list of its own to keep.
 */
export function SectionMenu(props: {
  container: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const [sections, setSections] = useState<Section[]>([])
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) setSections(readSections(props.container.current))
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant='outline'
            size='icon-sm'
            aria-label={t('Sections of this tab')}
          />
        }
      >
        <ListTree />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className='max-h-96 w-64 overflow-y-auto'
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('Sections of this tab')}</DropdownMenuLabel>
          {sections.map((section, index) => (
            <DropdownMenuItem
              // Two panels may share a title; their place tells them apart.
              // eslint-disable-next-line react/no-array-index-key
              key={`${index}:${section.title}`}
              onClick={() => section.element.scrollIntoView({ block: 'start' })}
            >
              <span className='truncate'>{section.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
