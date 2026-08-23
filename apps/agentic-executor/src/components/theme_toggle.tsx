'use client'

import { useTheme } from 'next-themes'
import { HugeiconsIcon } from '@hugeicons/react'
import { MoonIcon, Sun01Icon } from '@hugeicons/core-free-icons'

import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

function ThemeToggle() {
  const { setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'relative')}
        title="Toggle theme"
      >
        <HugeiconsIcon icon={Sun01Icon} strokeWidth={2} className="scale-100 dark:scale-0" />
        <HugeiconsIcon
          icon={MoonIcon}
          strokeWidth={2}
          className="absolute scale-0 dark:scale-100"
        />
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ThemeToggle }
