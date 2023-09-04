import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';

// Define Axios error type
interface AxiosError extends Error {
  response?: {
    status: number;
    data: any;
  };
}

const http = rateLimit(axios.create(), { maxRequests: 150, perMilliseconds: 60 * 60 * 1000 });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { track_name, artist_name } = req.query;

  try {
    const response = await http.get(`https://lyrist.vercel.app/api/${track_name}/${artist_name}`);
    const { lyrics, image } = response.data;
    if (lyrics && image) {
      res.status(200).json({ lyrics, image });
    } else {
      res.status(404).json({ message: "Lyrics or image not found" });
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      const axiosError = error as AxiosError;
      res.status(axiosError.response?.status || 500).json(axiosError.response?.data || {});
    } else {
      res.status(500).json({ message: "Unknown error" });
    }
  }
}
