import axios from 'axios';
import type { AxiosRequestConfig, AxiosError } from 'axios';
import { BackendRoute } from './constants';
import { toast } from 'sonner';

// Extend AxiosRequestConfig to include suppressErrorToast
interface CustomAxiosRequestConfig extends AxiosRequestConfig {
  suppressErrorToast?: boolean;
}

// Shape of every successful server response: { success, data, message? }
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:5000',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 1200000
});

// Add request interceptor for authentication
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Flag to prevent multiple refresh token requests
let isRefreshing = false;
let failedQueue: {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}[] = [];

// Process the queue of failed requests
const processQueue = (
  error: AxiosError | null,
  token: string | null = null
) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve(token);
    }
  });

  failedQueue = [];
};

// Add response interceptor for error handling and token refresh
api.interceptors.response.use(
  // Unwrap the axios envelope: callers receive the server payload ({ success, data, message })
  // so response.data gives the typed entity directly.
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status !== 401 || originalRequest._retry) {
      // Don't show toast if suppressErrorToast is set in config
      if (!originalRequest.suppressErrorToast) {
        if (error.response?.data?.error?.message) {
          toast.error(error.response?.data?.error?.message);
        } else if (error.message) {
          toast.error(`Error: ${error.message}`);
        } else {
          toast.error('An error occurred. Please try again.');
        }
      }
      return Promise.reject(error);
    }

    // If we're already refreshing, queue this request
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        })
        .catch((err) => {
          return Promise.reject(err);
        });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = localStorage.getItem('refreshToken');

      // If no refresh token, clear auth and redirect
      if (!refreshToken) {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');

        if (
          window.location.pathname !== '/' &&
          !window.location.pathname.includes('/login')
        ) {
          window.location.href = '/';
        }

        return Promise.reject(error);
      }

      // Try to refresh the token (raw axios — not intercepted)
      const response = await axios.post(
        `${api.defaults.baseURL}${BackendRoute.AUTH_REFRESH_TOKEN}`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } }
      );

      // Server returns { success, data: { accessToken, refreshToken } }
      const { accessToken, refreshToken: newRefreshToken } = response.data.data;

      // Store the new tokens
      localStorage.setItem('token', accessToken);
      localStorage.setItem('refreshToken', newRefreshToken);

      // Update the authorization header
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;

      // Process the queue with the new token
      processQueue(null, accessToken);

      // Return the original request with the new token
      return api(originalRequest);
    } catch (refreshError) {
      // If refresh fails, clear auth and redirect
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');

      // Show error toast
      toast.error('Your session has expired. Please log in again.');

      // Process the queue with the error
      processQueue(refreshError as AxiosError);

      // Redirect if not already on home or login page
      if (
        window.location.pathname !== '/' &&
        !window.location.pathname.includes('/login')
      ) {
        window.location.href = '/';
      }

      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

/**
 * Backend service for API calls.
 *
 * The response interceptor unwraps the axios envelope, so each method resolves
 * with ApiResponse<T> — the server payload { success, data, message? } — rather
 * than a full AxiosResponse. Callers access the entity via response.data.
 */
export const backendService = {
  get: <T = unknown>(url: string, config?: CustomAxiosRequestConfig): Promise<ApiResponse<T>> =>
    api.get(url, config) as unknown as Promise<ApiResponse<T>>,
  post: <T = unknown>(url: string, data?: unknown, config?: CustomAxiosRequestConfig): Promise<ApiResponse<T>> =>
    api.post(url, data, config) as unknown as Promise<ApiResponse<T>>,
  put: <T = unknown>(url: string, data?: unknown, config?: CustomAxiosRequestConfig): Promise<ApiResponse<T>> =>
    api.put(url, data, config) as unknown as Promise<ApiResponse<T>>,
  patch: <T = unknown>(url: string, data?: unknown, config?: CustomAxiosRequestConfig): Promise<ApiResponse<T>> =>
    api.patch(url, data, config) as unknown as Promise<ApiResponse<T>>,
  delete: <T = unknown>(url: string, config?: CustomAxiosRequestConfig): Promise<ApiResponse<T>> =>
    api.delete(url, config) as unknown as Promise<ApiResponse<T>>,
  getFile: <T = unknown>(id: string): Promise<ApiResponse<T>> =>
    api.get(`/files/${id}`) as unknown as Promise<ApiResponse<T>>,
};
