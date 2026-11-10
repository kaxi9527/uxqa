import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

const buttonVariants = cva("inline-flex items-center", {
  variants: {
    variant: { default: "bg-primary", outline: "border", ghost: "" },
    size: { default: "h-9 px-4", sm: "h-8 px-3" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export function Button({ asChild = false, ...props }: { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={buttonVariants({})} {...props} />;
}
export { buttonVariants };
