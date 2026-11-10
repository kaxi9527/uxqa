import { cva } from 'class-variance-authority';

export { default as Button } from './Button.vue';

export const buttonVariants = cva('inline-flex items-center rounded-md text-sm font-medium', {
  variants: {
    variant: { default: 'bg-primary text-white', outline: 'border border-border bg-transparent' },
    size: { default: 'h-9 px-4', sm: 'h-8 px-3' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
