import { useState } from "react";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { SearchableSelect } from "../ui/searchable-select";
import { useCategories } from "../../backend/category.service";
import type { GameStatus } from "../../backend/types";

interface FilterSheetProps {
  children: React.ReactNode;
  onFilter: (filters: { categoryId?: string; status?: GameStatus }) => void;
  onReset: () => void;
}

export function FilterSheet({ children, onFilter, onReset }: FilterSheetProps) {
  const { data: categories } = useCategories();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent className="font-dmmono dark:bg-[#0F1621]">
        <SheetHeader>
          <SheetTitle className="text-lg font-normal tracking-wider mt-6">
            Filter
          </SheetTitle>
          <div className="border border-b-gray-200"></div>
        </SheetHeader>
        <form
          className="grid gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            onFilter({
              categoryId:
                selectedCategory === "all" ? undefined : selectedCategory,
              status:
                selectedStatus === "all"
                  ? undefined
                  : (selectedStatus as GameStatus),
            });
          }}
        >
          {/* category */}
          <div className="items-center gap-4">
            <div className="flex flex-col space-y-2">
              <Label htmlFor="category" className="text-right text-base">
                Select Category
              </Label>
              <SearchableSelect
                value={selectedCategory}
                onValueChange={(value) => setSelectedCategory(value as string)}
                options={[
                  { value: "all", label: "All Categories" },
                  ...(categories?.map((category) => ({
                    value: category.id,
                    label: category.name
                  })) || [])
                ]}
                placeholder="Select category"
                searchPlaceholder="Search categories..."
                emptyText="No categories found"
              />
            </div>
          </div>
          {/* status */}
          <div className="items-center gap-4">
            <div className="flex flex-col space-y-2">
              <Label htmlFor="status" className="text-right text-base">
                Select Game Status
              </Label>
              <SearchableSelect
                value={selectedStatus}
                onValueChange={(value) => setSelectedStatus(value as string)}
                options={[
                  { value: "all", label: "All Status" },
                  { value: "active", label: "Active" },
                  { value: "disabled", label: "Disabled" }
                ]}
                placeholder="Select status"
                searchPlaceholder="Search status..."
                emptyText="No status found"
              />
            </div>
          </div>
          <div className="flex gap-3 justify-end px-2">
            <SheetClose asChild>
              <Button
                type="button"
                onClick={() => {
                  setSelectedCategory("all");
                  setSelectedStatus("all");
                  onReset();
                }}
                className="w-20 h-12 text-[#334154] bg-[#F8FAFC] border border-[#E2E8F0] hover:bg-[#E2E8F0] dark:text-gray-300 dark:bg-[#1E293B] dark:border-[#334155] dark:hover:bg-[#334155] cursor-pointer"
              >
                Reset
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button
                type="submit"
                className="w-20 h-12 bg-[#6A7282] text-white hover:bg-[#5A626F] dark:text-white dark:hover:bg-[#5A626F] cursor-pointer"
              >
                Filter
              </Button>
            </SheetClose>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
