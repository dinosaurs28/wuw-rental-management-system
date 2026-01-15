import axios from "axios";
import { API_BASE_URL } from "./constants";

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true, // Important for cookies
});

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        // Optional: Global error handling hook
        // const status = error.response?.status;
        // if (status === 401) {
        //   // Handle unauthorized (e.g., redirect to login) if needed
        // }
        return Promise.reject(error);
    }
);

export default apiClient;
