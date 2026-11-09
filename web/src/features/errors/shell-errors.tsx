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
import type { ErrorComponentProps } from '@tanstack/react-router'

import { AuthenticatedLayout } from '@/components/layout'

import { GeneralError } from './general-error'
import { NotFoundError } from './not-found-error'

/*
 * A route's error boundary replaces that route's whole component, layout
 * included. The console layout route therefore renders the shell itself around
 * the error, so the sidebar and header stay on screen.
 */

/** errorComponent for the console layout route. */
export function ShellGeneralError(props: ErrorComponentProps) {
  return (
    <AuthenticatedLayout>
      <GeneralError error={props.error} embedded />
    </AuthenticatedLayout>
  )
}

/** notFoundComponent for the console layout route. */
export function ShellNotFoundError() {
  return (
    <AuthenticatedLayout>
      <NotFoundError embedded />
    </AuthenticatedLayout>
  )
}
