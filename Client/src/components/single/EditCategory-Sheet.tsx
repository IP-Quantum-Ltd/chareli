import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "../ui/sheet";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import {
  useCategoryById,
  useUpdateCategory,
  useDeleteCategory,
} from "../../backend/category.service";
import { toast } from "sonner";
import { Formik, Form, Field, ErrorMessage, useFormikContext } from "formik";
import { object as yupObject, string as yupString } from "yup";
import { DeleteConfirmationModal } from "../modals/DeleteConfirmationModal";
import { useQueryClient } from "@tanstack/react-query";
import { BackendRoute } from "../../backend/constants";
import {
  CATEGORY_FAQ_QUESTIONS,
  type CategoryFaqKey,
} from "../../utils/categoryFaq";

interface EditCategoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
}

interface FormValues {
  name: string;
  description?: string;
  introText?: string;
  faqAnswers: {
    whatAre: string;
    mostPopular: string;
    doINeedToDownload: string;
    areTheyFree: string;
  };
}

const FAQ_ANSWER_MAX = 200;
const INTRO_TEXT_WORD_MAX = 200;

const countWords = (v?: string) =>
  !v || v.trim().length === 0 ? 0 : v.trim().split(/\s+/).length;

const validationSchema = yupObject({
  name: yupString().required("Name is required"),
  description: yupString(),
  introText: yupString().test(
    "word-count",
    `Intro must be ${INTRO_TEXT_WORD_MAX} words or fewer`,
    (v) => countWords(v) <= INTRO_TEXT_WORD_MAX
  ),
  faqAnswers: yupObject({
    whatAre: yupString().max(FAQ_ANSWER_MAX),
    mostPopular: yupString().max(FAQ_ANSWER_MAX),
    doINeedToDownload: yupString().max(FAQ_ANSWER_MAX),
    areTheyFree: yupString().max(FAQ_ANSWER_MAX),
  }),
});

function IntroWordCount() {
  const { values } = useFormikContext<FormValues>();
  const count = countWords(values.introText);
  const over = count > INTRO_TEXT_WORD_MAX;
  return (
    <span
      className={`text-xs font-worksans ${
        over ? "text-red-500" : "text-[#6A7282] dark:text-gray-400"
      }`}
    >
      {count}/{INTRO_TEXT_WORD_MAX} words
    </span>
  );
}

function FaqAnswerCount({
  field,
}: Readonly<{ field: CategoryFaqKey }>) {
  const { values } = useFormikContext<FormValues>();
  const value = values.faqAnswers?.[field] ?? "";
  const over = value.length > FAQ_ANSWER_MAX;
  return (
    <span
      className={`text-xs font-worksans ${
        over ? "text-red-500" : "text-[#6A7282] dark:text-gray-400"
      }`}
    >
      {value.length}/{FAQ_ANSWER_MAX}
    </span>
  );
}

function RenderedQuestion({
  template,
}: Readonly<{ template: (name: string) => string }>) {
  const { values } = useFormikContext<FormValues>();
  return <>{template(values.name?.trim() || "[category]")}</>;
}

export function EditCategory({
  open,
  onOpenChange,
  categoryId,
}: EditCategoryProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { data: category, error } = useCategoryById(categoryId);
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const queryClient = useQueryClient();

  // Close sheet if category is not found
  useEffect(() => {
    const axiosError = error as { response?: { status: number } };
    if (axiosError?.response?.status === 404) {
      onOpenChange(false);
    }
  }, [error, onOpenChange]);

  const handleSubmit = async (values: FormValues, { setSubmitting }: any) => {
    try {
      const trimmedAnswers = {
        whatAre: values.faqAnswers.whatAre.trim(),
        mostPopular: values.faqAnswers.mostPopular.trim(),
        doINeedToDownload: values.faqAnswers.doINeedToDownload.trim(),
        areTheyFree: values.faqAnswers.areTheyFree.trim(),
      };
      const hasAnyAnswer = Object.values(trimmedAnswers).some(
        (a) => a.length > 0
      );

      await updateCategory.mutateAsync({
        id: categoryId,
        data: {
          name: values.name,
          description: values.description,
          introText: values.introText?.trim() ? values.introText.trim() : null,
          faqAnswers: hasAnyAnswer ? trimmedAnswers : null,
        },
      });
      toast.success("Category updated successfully!");
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to update category");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteCategory.mutateAsync(categoryId);
      queryClient.invalidateQueries({ queryKey: [BackendRoute.CATEGORIES] });
      toast.success("Category deleted successfully");
      setShowDeleteModal(false);
      onOpenChange(false);
    } catch (error: any) {
      toast.error("Failed to delete category");
    }
  };

  if (!category) return null;

  const initialValues: FormValues = {
    name: category.name,
    description: category.description || "",
    introText: category.introText || "",
    faqAnswers: {
      whatAre: category.faqAnswers?.whatAre || "",
      mostPopular: category.faqAnswers?.mostPopular || "",
      doINeedToDownload: category.faqAnswers?.doINeedToDownload || "",
      areTheyFree: category.faqAnswers?.areTheyFree || "",
    },
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-lg w-[90vw] bg-white dark:bg-[#18192b] border-l border-gray-200 dark:border-gray-800 overflow-y-auto"
      >
        <SheetHeader className="pb-4 mt-8 font-dmmono">
          <SheetTitle className="text-lg font-bold border-b">
            Edit Category
          </SheetTitle>
        </SheetHeader>

        <Formik
          initialValues={initialValues}
          validationSchema={validationSchema}
          onSubmit={handleSubmit}
        >
          {({ isSubmitting }) => (
            <Form className="flex flex-col gap-6 mt-2 font-dmmono px-3">
              <div>
                <Label htmlFor="name" className="text-base mb-1">
                  Category Name
                </Label>
                <Field
                  as={Input}
                  id="name"
                  name="name"
                  placeholder="Name"
                  className="bg-[#F5F6FA] mt-1  font-worksans text-sm tracking-wider dark:bg-[#121C2D] dark:text-white"
                />
                <ErrorMessage
                  name="name"
                  component="div"
                  className="text-red-500  mt-1 font-worksans text-sm tracking-wider"
                /> 
              </div>

              <div>
                <Label htmlFor="description" className="text-base mb-1 mt-4">
                  Game Description
                </Label>
                <Field
                  as="textarea"
                  id="description"
                  name="description"
                  placeholder="Description"
                  className="bg-[#F5F6FA] mt-1  rounded-md border border-input w-full min-h-[100px] p-3 resize-none font-worksans text-sm tracking-wider dark:bg-[#121C2D] dark:text-white"
                />
                <ErrorMessage
                  name="description"
                  component="div"
                  className="text-red-500  mt-1 font-worksans text-xl tracking-wider"
                />
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="introText" className="text-base mb-1 mt-4">
                    Intro Text
                  </Label>
                  <IntroWordCount />
                </div>
                <p className="text-xs text-[#6A7282] dark:text-gray-400 font-worksans mb-1">
                  Shown under the games grid on the public landing page. Up to{" "}
                  {INTRO_TEXT_WORD_MAX} words.
                </p>
                <Field
                  as="textarea"
                  id="introText"
                  name="introText"
                  placeholder="Write a short introduction about this category"
                  className="bg-[#F5F6FA] mt-1 rounded-md border border-input w-full min-h-[120px] p-3 resize-none font-worksans text-sm tracking-wider dark:bg-[#121C2D] dark:text-white"
                />
                <ErrorMessage
                  name="introText"
                  component="div"
                  className="text-red-500 mt-1 font-worksans text-sm tracking-wider"
                />
              </div>

              <div className="space-y-4">
                <Label className="text-base">FAQ Answers</Label>
                <p className="text-xs text-[#6A7282] dark:text-gray-400 font-worksans">
                  Each answer is shown publicly under the matching question.
                  Leave blank to omit a question. {FAQ_ANSWER_MAX} characters
                  max.
                </p>
                {CATEGORY_FAQ_QUESTIONS.map(({ key, template }) => (
                  <div key={key}>
                    <div className="flex items-baseline justify-between">
                      <Label
                        htmlFor={`faqAnswers.${key}`}
                        className="text-sm font-worksans"
                      >
                        <RenderedQuestion template={template} />
                      </Label>
                      <FaqAnswerCount field={key} />
                    </div>
                    <Field
                      as="textarea"
                      id={`faqAnswers.${key}`}
                      name={`faqAnswers.${key}`}
                      maxLength={FAQ_ANSWER_MAX}
                      placeholder="Answer (max 200 characters)"
                      className="bg-[#F5F6FA] mt-1 rounded-md border border-input w-full min-h-[64px] p-3 resize-none font-worksans text-sm tracking-wider dark:bg-[#121C2D] dark:text-white"
                    />
                    <ErrorMessage
                      name={`faqAnswers.${key}`}
                      component="div"
                      className="text-red-500 mt-1 font-worksans text-xs tracking-wider"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-between mt-8 items-center">
                {!category.isDefault && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setShowDeleteModal(true)}
                    className="dark:bg-[#EF4444]"
                  >
                    Delete
                  </Button>
                )}
                <div className="flex gap-3 flex-1 justify-end">
                  <SheetClose asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="dark:text-black dark:bg-white cursor-pointer"
                    >
                      Cancel
                    </Button>
                  </SheetClose>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    variant="default"
                    className="bg-[#6A7282] hover:bg-[#5A626F] dark:text-white cursor-pointer"
                  >
                    {isSubmitting ? "Updating..." : "Update"}
                  </Button>
                </div>
              </div>
            </Form>
          )}
        </Formik>

        <DeleteConfirmationModal
          open={showDeleteModal}
          onOpenChange={setShowDeleteModal}
          onConfirm={handleDelete}
          isDeleting={deleteCategory.isPending}
          title="Are you sure you want to Delete Category?"
          description="This action cannot be reversed"
        />
      </SheetContent>
    </Sheet>
  );
}

export default EditCategory;
