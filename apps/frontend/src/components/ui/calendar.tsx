import * as React from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
} from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import "react-day-picker/dist/style.css";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-white group/calendar p-6",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className,
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "flex gap-10 flex-col lg:flex-row relative",
          defaultClassNames.months,
        ),
        month: cn("flex flex-col gap-4 w-[300px]", defaultClassNames.month),
        nav: cn(
          "flex items-center gap-1 w-full absolute top-2 inset-x-0 justify-between z-10 pointer-events-none",
          defaultClassNames.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "pointer-events-auto size-8 bg-transparent hover:bg-gray-100 text-gray-900 rounded-full transition-all aria-disabled:opacity-50 p-0 select-none shadow-none",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "pointer-events-auto size-8 bg-transparent hover:bg-gray-100 text-gray-900 rounded-full transition-all aria-disabled:opacity-50 p-0 select-none shadow-none",
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          "flex items-center justify-center h-10 w-full font-sans mb-2",
          defaultClassNames.month_caption,
        ),
        caption_label: cn(
          "select-none font-black text-xl text-black tracking-tight capitalize",
          defaultClassNames.caption_label,
        ),
        table: "w-full border-collapse",
        weekdays: cn("grid grid-cols-7", defaultClassNames.weekdays),
        weekday: cn(
          "text-gray-500 flex items-center justify-center font-bold text-xs uppercase tracking-widest select-none mb-4",
          defaultClassNames.weekday,
        ),
        week: cn("grid grid-cols-7 mt-2", defaultClassNames.week),
        day: cn(
          "relative flex items-center justify-center p-0 text-center [&:last-child[data-selected=true]_button]:rounded-r-xl group/day select-none",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-xl"
            : "[&:first-child[data-selected=true]_button]:rounded-l-xl",
          defaultClassNames.day,
        ),
        range_start: cn(
          "rounded-l-xl",
          defaultClassNames.range_start,
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn(
          "rounded-r-xl",
          defaultClassNames.range_end,
        ),
        today: cn(
          "bg-gray-100 text-black rounded-xl font-bold",
          defaultClassNames.today,
        ),
        outside: cn(
          "text-gray-300 aria-selected:text-gray-300",
          defaultClassNames.outside,
        ),
        disabled: cn("text-gray-300 opacity-50", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          );
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-5", className)} strokeWidth={3} {...props} />
            );
          }
          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-5", className)}
                strokeWidth={3}
                {...props}
              />
            );
          }
          return (
            <ChevronDownIcon className={cn("size-5", className)} strokeWidth={3} {...props} />
          );
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "flex outline-none w-10 h-10 items-center justify-center font-bold transition-all duration-200",
        "text-gray-900 hover:bg-gray-100 hover:text-black rounded-xl",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-black/50",
        "data-[selected-single=true]:bg-[#1A1A1A] data-[selected-single=true]:text-white data-[selected-single=true]:rounded-xl",
        "data-[range-start=true]:bg-[#1A1A1A] data-[range-start=true]:text-white data-[range-start=true]:rounded-l-xl data-[range-start=true]:rounded-r-none",
        "data-[range-end=true]:bg-[#1A1A1A] data-[range-end=true]:text-white data-[range-end=true]:rounded-r-xl data-[range-end=true]:rounded-l-none",
        "data-[range-middle=true]:bg-gray-100 data-[range-middle=true]:text-gray-900 data-[range-middle=true]:rounded-none data-[range-middle=true]:hover:bg-gray-200",
        "group-data-[focused=true]/day:relative group-[.rdp-day_button:focus-visible]:z-10",
        "[&>span]:text-xs [&>span]:opacity-70 !ring-0 !outline-none",
        defaultClassNames.day,
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
