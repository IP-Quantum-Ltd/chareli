import { Link } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../ui/breadcrumb';

interface GameBreadcrumbProps {
  categoryName?: string;
  categorySlug?: string;
  gameTitle: string;
  overrideLink?: string;
  overrideText?: string;
}

export function GameBreadcrumb({
  categoryName,
  categorySlug,
  gameTitle,
  overrideLink,
  overrideText,
}: GameBreadcrumbProps) {
  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/">Arcades Box</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {overrideLink && overrideText ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={overrideLink}>{overrideText}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        ) : categoryName && categorySlug ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={`/categories/${categorySlug}`}>
                  {categoryName}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        ) : null}
        <BreadcrumbItem>
          <BreadcrumbPage className="font-semibold text-foreground">
            {gameTitle}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
