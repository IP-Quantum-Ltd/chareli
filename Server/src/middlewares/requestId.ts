import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

export interface RequestContext {
  reqId: string;
  userId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const requestId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const incoming = req.header('X-Request-Id');
  const id = incoming && VALID_ID.test(incoming) ? incoming : uuidv4();

  req.id = id;
  res.setHeader('X-Request-Id', id);

  const store: RequestContext = { reqId: id };
  requestContext.run(store, () => next());
};

export const attachUserToRequestContext = (userId: string | undefined): void => {
  if (!userId) return;
  const store = requestContext.getStore();
  if (store) store.userId = userId;
};

export const getRequestContext = (): RequestContext | undefined =>
  requestContext.getStore();
