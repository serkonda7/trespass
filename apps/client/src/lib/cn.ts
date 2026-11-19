import { type ClassNameValue, twMerge } from "tailwind-merge";

/** Merge class names; later Tailwind classes win. */
export function cn(...inputs: ClassNameValue[]) {
  return twMerge(...inputs);
}
