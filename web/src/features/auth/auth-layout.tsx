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
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeSwitch } from '@/components/theme-switch'

import {
  AuthBrandMark,
  AuthBrandPanel,
  AuthMobileTagline,
} from './components/auth-brand-panel'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout(props: AuthLayoutProps) {
  return (
    <div className='bg-background grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]'>
      <AuthBrandPanel />
      <main className='flex min-h-svh flex-col px-4 py-6 sm:px-8 lg:py-8'>
        <div className='flex items-center justify-between gap-4'>
          <AuthBrandMark className='lg:invisible' />
          <div className='flex items-center gap-1'>
            <LanguageSwitcher />
            <ThemeSwitch />
          </div>
        </div>
        <AuthMobileTagline className='mt-2 lg:hidden' />
        <div className='flex flex-1 items-center justify-center py-10'>
          <div className='w-full max-w-sm'>{props.children}</div>
        </div>
      </main>
    </div>
  )
}
