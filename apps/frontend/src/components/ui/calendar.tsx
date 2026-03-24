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
        "bg-background group/calendar p-3 [--cell-size:--spacing(8)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
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
          "flex gap-4 flex-col md:flex-row relative",
          defaultClassNames.months,
        ),
        month: cn("flex flex-col w-full gap-4", defaultClassNames.month),
        nav: cn(
          "flex items-center gap-1 w-full absolute top-0 inset-x-0 justify-between z-10 pointer-events-none",
          defaultClassNames.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "pointer-events-auto size-(--cell-size) bg-white/5 hover:bg-white/10 border border-white/5 text-white rounded-full transition-all aria-disabled:opacity-50 p-0 select-none shadow-xl",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "pointer-events-auto size-(--cell-size) bg-white/5 hover:bg-white/10 border border-white/5 text-white rounded-full transition-all aria-disabled:opacity-50 p-0 select-none shadow-xl",
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          "flex items-center justify-center h-(--cell-size) w-full px-(--cell-size) font-serif",
          defaultClassNames.month_caption,
        ),
        dropdowns: cn(
          "w-full flex items-center text-sm font-medium justify-center h-(--cell-size) gap-1.5",
          defaultClassNames.dropdowns,
        ),
        dropdown_root: cn(
          "relative flex items-center border border-white/10 bg-black/40 rounded-md px-2 py-0.5",
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn(
          "absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer", 
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "select-none font-bold text-lg text-white tracking-wide",
          defaultClassNames.caption_label,
        ),
        table: "w-full border-collapse mt-2",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-zinc-500 flex-1 font-bold text-[0.7rem] uppercase tracking-widest select-none mb-3",
          defaultClassNames.weekday,
        ),
        week: cn("flex w-full mt-1", defaultClassNames.week),
        week_number_header: cn(
          "select-none w-(--cell-size)",
          defaultClassNames.week_number_header,
        ),
        week_number: cn(
          "text-[0.8rem] select-none text-zinc-500",
          defaultClassNames.week_number,
        ),
        day: cn(
          "relative w-full h-full p-0 text-center [&:last-child[data-selected=true]_button]:rounded-r-full group/day aspect-square select-none",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-full"
            : "[&:first-child[data-selected=true]_button]:rounded-l-full",
          defaultClassNames.day,
        ),
        range_start: cn(
          "rounded-l-full bg-white/10",
          defaultClassNames.range_start,
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn(
          "rounded-r-full bg-white/10",
          defaultClassNames.range_end,
        ),
        today: cn(
          "bg-white/5 text-white rounded-full data-[selected=true]:rounded-none data-[selected=true]:bg-transparent font-bold",
          defaultClassNames.today,
        ),
        outside: cn(
          "text-zinc-700 aria-selected:text-zinc-500",
          defaultClassNames.outside,
        ),
        disabled: cn("text-zinc-700 opacity-50", defaultClassNames.disabled),
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
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            );
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            );
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          );
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          );
        },
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
        "flex outline-none size-full flex-col items-center justify-center gap-1 leading-none font-medium transition-all duration-300",
        "text-zinc-300 hover:bg-white/10 hover:text-white rounded-full",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:font-bold data-[selected-single=true]:shadow-[0_0_20px_rgba(255,95,0,0.4)]",
        "data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-start=true]:rounded-l-full data-[range-start=true]:rounded-r-none data-[range-start=true]:font-bold data-[range-start=true]:shadow-[0_0_20px_rgba(255,95,0,0.4)]",
        "data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-end=true]:rounded-r-full data-[range-end=true]:rounded-l-none data-[range-end=true]:font-bold data-[range-end=true]:shadow-[0_0_20px_rgba(255,95,0,0.4)]",
        "data-[range-middle=true]:bg-primary/20 data-[range-middle=true]:text-white data-[range-middle=true]:rounded-none",
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
