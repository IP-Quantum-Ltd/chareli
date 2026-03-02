import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
import React from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { useInviteTeamMember } from "../../backend/teams.service";
import { useAuth } from "../../context/AuthContext";
import { toast } from "sonner";
import { object as yupObject, string as yupString } from "yup";
import type { InviteUserRequest } from "../../backend/teams.service";

// Dynamic validation schema based on user role
const createInviteSchema = (availableRoles: string[]) => yupObject().shape({
  email: yupString()
    .email("Invalid email format")
    .required("Email is required"),
  role: yupString()
    .oneOf(availableRoles, "Invalid role")
    .required("Role is required"),
});

const getInitialValues = (availableRoles: string[]): InviteUserRequest => ({
  email: "",
  role: availableRoles[0] as any, // Default to first available role
});

export function InviteSheet({ children }: { children: React.ReactNode }) {
  const formikRef = React.useRef<any>(null);
  const { mutate: inviteTeamMember, isPending } = useInviteTeamMember();
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);

  // Determine available roles based on current user's role
  const getAvailableRoles = () => {
    const userRole = user?.role?.name?.toLowerCase();

    if (userRole === 'superadmin') {
      return [
        { value: "superadmin", label: "Super Admin" },
        { value: "admin", label: "Admin" },
        { value: "editor", label: "Editor" },
        { value: "viewer", label: "Viewer" }
      ];
    } else if (userRole === 'admin') {
      return [
        { value: "editor", label: "Editor" },
        { value: "viewer", label: "Viewer" }
      ];
    }

    // Default fallback (shouldn't happen if permissions are correct)
    return [{ value: "viewer", label: "Viewer" }];
  };

  const availableRoles = getAvailableRoles();
  const availableRoleValues = availableRoles.map(role => role.value);
  const initialValues = getInitialValues(availableRoleValues);
  const inviteSchema = createInviteSchema(availableRoleValues);

  const handleInvite = async (
    values: InviteUserRequest,
    { resetForm }: any
  ) => {
    inviteTeamMember(values, {
      onSuccess: () => {
        toast.success("Invitation sent successfully");
        resetForm();
        setOpen(false);
      },
      onError: (error: any) => {
        console.log("my error", error);
        const message =
          error?.response?.data?.message ||
          error?.message ||
          "Failed to send invitation";

        toast.error(message);
      },
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen && formikRef.current) {
          formikRef.current.resetForm();
        }
        setOpen(newOpen);
      }}
    >
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent className="font-dmmono dark:bg-[#0F1621] max-w-md w-full">
        <SheetHeader>
          <SheetTitle className="text-lg font-normal tracking-wider mt-6">
            Share Admin Invite
          </SheetTitle>
          <div className="border border-b-gray-200"></div>
        </SheetHeader>
        <Formik
          initialValues={initialValues}
          validationSchema={inviteSchema}
          onSubmit={handleInvite}
          innerRef={formikRef}
        >
          {({ isSubmitting, isValid, dirty }) => (
            <Form className="grid gap-6 px-4">
              <div className="flex flex-col space-y-2">
                <Label htmlFor="email" className="text-base">
                  User Email
                </Label>
                <Field
                  as={Input}
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Enter email"
                  className="col-span-3 shadow-none text-gray-400 font-thin text-sm tracking-wider h-14 bg-[#F1F5F9] border border-[#CBD5E0] dark:bg-[#121C2D] dark:text-white"
                />
                <ErrorMessage
                  name="email"
                  component="div"
                  className="text-red-500 text-xs mt-1"
                />
              </div>
              <div className="flex flex-col space-y-2">
                <Label className="text-base">
                  Role
                </Label>
                <Field name="role">
                  {({ field, form }: any) => (
                    <SearchableSelect
                      value={field.value}
                      onValueChange={(value: string | string[]) => {
                        if (typeof value === 'string') {
                          form.setFieldValue("role", value);
                        }
                      }}
                      options={availableRoles}
                      placeholder="Select role"
                      searchPlaceholder="Search roles..."
                      emptyText="No roles found"
                    />
                  )}
                </Field>
                <ErrorMessage
                  name="role"
                  component="div"
                  className="text-red-500 text-xs mt-1"
                />
              </div>
              <div className="flex gap-3 justify-end px-2">
                <SheetClose asChild>
                  <Button
                    type="button"
                    className="w-20 h-12 text-[#334154] bg-[#F8FAFC] border border-[#E2E8F0] hover:bg-[#E2E8F0] dark:text-gray-300 dark:bg-[#1E293B] dark:border-[#334155] dark:hover:bg-[#334155] cursor-pointer"
                    onClick={() => formikRef.current?.resetForm()}
                  >
                    Cancel
                  </Button>
                </SheetClose>
                <Button
                  type="submit"
                  className="w-fit h-12 bg-[#6A7282] text-white hover:bg-[#5A626F] dark:text-white dark:hover:bg-[#6A7282] cursor-pointer"
                  disabled={isSubmitting || isPending || !isValid || !dirty}
                >
                  {isSubmitting || isPending ? "Sending..." : "Send Invite"}
                </Button>
              </div>
            </Form>
          )}
        </Formik>
      </SheetContent>
    </Sheet>
  );
}
