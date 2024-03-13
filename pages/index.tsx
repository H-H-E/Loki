import type { NextPage } from "next";
import { useRef, useState } from "react";
import Header from "../components/Header";
import LoadingDots from "../components/LoadingDots";
import  LyricsGeneratorForm  from '../components/LyricsGeneratorForm';
import { Card, CardContent }  from "../components/ui/card";
import { CarouselItem, CarouselContent, CarouselPrevious, CarouselNext, Carousel } from "../components/ui/carousel";
import { History } from "../components/History";


import {
  createParser,
  ParsedEvent,
  ReconnectInterval,
} from "eventsource-parser";

import GoogleSearchEngine from "../components/GoogleSearchEngine";

import image1 from "../public/light.png";
import image2 from "../public/dark.png";

interface LyricsDecisionCardProps {
  onUseLyrics: (lyrics: string) => void;
  
}

interface LyricsData {
  lyrics: string;
  image: string;
}

const fetchOriginalLyrics = async (
  trackName: string,
  artistName: string
): Promise<LyricsData> => {
  try {
    const response = await fetch(
      `/api/retrieve?track_name=${trackName}&artist_name=${artistName}`
    );
    if (response.ok) {
      const data: LyricsData = await response.json();
      return data;
    }
  } catch (error) {
    console.error("Failed to fetch lyrics:", error);
  }
  return { lyrics: "", image: "" };
};

const LyricsDecisionCard: React.FC<LyricsDecisionCardProps> = ({
  onUseLyrics,
}) => {
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [image, setImage] = useState("");
  const [artistName, setArtistName] = useState("");
  const [trackName, setTrackName] = useState("");

  const tryAgain = () => {
    setShowLyrics(false);
    setLyrics("");
    setImage("");
  };

  const fetchAndShowLyrics = async () => {
    const { lyrics, image } = await fetchOriginalLyrics(trackName, artistName);
    setLyrics(lyrics);
    setImage(image);
    setShowLyrics(true);
  };

  return (
    <div className="order-1 flex flex-col space-y-4 container-mx-auto">
      {!showLyrics ? (
        <div className="object-center mx-auto space-y-4 flex flex-col">
          <input
            className="p-2 border rounded mx-auto max-w-sm"
            type="text"
            placeholder="Artist Name"
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
          />
          <input
            className="p-2 border rounded mx-auto max-w-sm"
            type="text"
            placeholder="Track Name"
            value={trackName}
            onChange={(e) => setTrackName(e.target.value)}
          />
          <button
            className="p-2 bg-black text-white max-w-sm mx-auto rounded"
            onClick={fetchAndShowLyrics}
          >
            Fetch Lyrics
          </button>
        </div>
      ) : (
        <div className="sticky">
          <div className="bg-white rounded p-4 shadow-md flex flex-col items-center space-y-2 max-w-md mx-auto ">
            <h2 className="text-xl font-semibold sticky-0 items-center">
              Original Lyrics
            </h2>
            {image && (
              <img
                className="w-40 h-40 object-center rounded"
                src={image}
                alt={`${trackName} by ${artistName}`}
              />
            )}
            <div className="flex space-x-2">
              <button
                className="p-2 bg-black text-white rounded"
                onClick={() => onUseLyrics(lyrics)}
              >
                Use These Lyrics
              </button>
              <button
                className="p-2 bg-blue-700 text-white rounded"
                onClick={tryAgain}
              >
                Try Again
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              <p className="text-center whitespace-pre-line">{lyrics}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
const ClickableImage: React.FC = () => {
  const [isImageOne, setIsImageOne] = useState(true);

  const handleClick = () => {
    setIsImageOne(!isImageOne);
  };

  return (
    <img
      className="w-40 h-40 mx-auto rounded"
      src={isImageOne ? '/dark.png' : '/light.png' }
      alt="clickable"
      onClick={handleClick}
    />
  );
};







const LyricsGenerator: NextPage = () => {
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState("");
  const [originalLyrics, setOriginalLyrics] = useState("");
  const [generatedLyrics, setGeneratedLyrics] = useState("");
  const [history, setHistory] = useState([]);
  const lyricsRef = useRef<null | HTMLDivElement>(null);

  const scrollToLyrics = () => {
    if (lyricsRef.current !== null) {
      lyricsRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };
  const fetchOriginalLyrics = async (trackName: string, artistName: string) => {
    try {
      const response = await fetch(`/api/${trackName}/${artistName}`);
      if (response.ok) {
        const data = await response.json();
        setOriginalLyrics(data.lyrics);
      }
    } catch (error) {
      console.error("Failed to fetch lyrics:", error);
    }
  };

  const generateLyrics = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setGeneratedLyrics("");
    setLoading(true);

    const prompt = `Your task is to rewrite the lyrics of a given song to revolve around a specific topic provided. The goal is to keep the original rhythm and structure of the song, adapting and substitifying words to create a new set of lyrics in line with the given theme. You should stay true to the song's rhyme scheme and musicality, whilst making sure the lyrics provide a coherent narrative around the topic and can be sung with the same tune of the song. Your input would be the original lyrics of the song, along with the specified topic, and your output would be the adapted lyrics revolving around that topic. While rewriting, remember to not only focus on thematic relevance but also ensure that your lyrics preserve the musical appeal of the original song. Essentially, you're creating a completely different version of the song that can stand on its own while staying true to the original's musical qualities. Topic:  "${topic}" Original lyrics: ${originalLyrics} Please provide the lyrics line by line.`;

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
      }),
    });

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const data = response.body;
    if (!data) {
      return;
    }

    const onParse = (event: ParsedEvent | ReconnectInterval) => {
      if (event.type === "event") {
        const data = event.data;
        try {
          const text = JSON.parse(data).text ?? "";
          setGeneratedLyrics((prev) => prev + text);
          setHistory((prevHistory) => [...prevHistory, { songTitle: "Your Song Title", parodyTitle: "Your Parody Title", artist: "Artist Name", generationDate: new Date().toISOString().split('T')[0], lyrics: generatedLyrics }]);
        } catch (e) {
          console.error(e);
        }
      }
    };

    const reader = data.getReader();
    const decoder = new TextDecoder();
    const parser = createParser(onParse);
    let done = false;
    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      const chunkValue = decoder.decode(value);
      parser.feed(chunkValue);
    }
    scrollToLyrics();
    setLoading(false);
  };

  return (
    <div className="container w-full  mx-auto p-4 max-height">
     
     <main className="flex justify-center items-center min-h-screen pt-20">      
     <Carousel className="w-full max-w-xxl mx-auto">      
      <CarouselContent>
        <CarouselItem>
            <Card>
              <CardContent className="w-half flex items-center justify-center p-6 gap-4 flex-col">
                <LyricsDecisionCard
                  onUseLyrics={(lyrics: string) => setOriginalLyrics(lyrics)}
                />
              </CardContent>
            </Card>
          
        </CarouselItem>
        <CarouselItem>
          <div className="p-1">
            <Card>
              <CardContent className="flex items-center justify-center  p-6 gap-4 flex-col ">
                <LyricsGeneratorForm
                  topic={topic}
                  setTopic={setTopic}
                  originalLyrics={originalLyrics}
                  setOriginalLyrics={setOriginalLyrics}
                  generateLyrics={generateLyrics}
                  loading={loading}
                  generatedLyrics={generatedLyrics}
                />
              </CardContent>
            </Card>
          </div>
        </CarouselItem>
        <CarouselItem >
        <Card  >
          <CardContent className="flex items-center justify-center p-6 gap-4 flex-col">
          <History history={history} />
        </CardContent>
        </Card>

        </CarouselItem>
      </CarouselContent>
      <CarouselNext />
      <CarouselPrevious />

    </Carousel>
   

  

        
         
      </main>
    </div>
  );
};

export default LyricsGenerator;
