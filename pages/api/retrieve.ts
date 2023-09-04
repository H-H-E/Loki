import axios from 'axios';
import rateLimit from 'axios-rate-limit';

// Create an axios instance with rate limiting
const http = rateLimit(axios.create(), { maxRequests: 150, perMilliseconds: 60 * 60 * 1000 });

export default async function handler(req, res) {
  const { track_name, artist_name } = req.query;

  try {
    const response = await http.get(`https://lyrist.vercel.app/api/${track_name}/${artist_name}`);
    const { lyrics, image } = response.data;
    if (lyrics && image) {
      res.status(200).json({ lyrics, image });
    } else {
      res.status(404).json({ message: "Lyrics or image not found" });
    }
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || {});
  }
}
