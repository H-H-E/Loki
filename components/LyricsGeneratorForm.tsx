// components/LyricsGeneratorForm.tsx

import React from 'react';
import LyricCard from './LyricCard';

interface LyricsGeneratorFormProps {
  topic: string;
  setTopic: (topic: string) => void;
  originalLyrics: string;
  setOriginalLyrics: (lyrics: string) => void;
  generateLyrics: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;

  loading: boolean;
  generatedLyrics: string;
}

const LyricsGeneratorForm: React.FC<LyricsGeneratorFormProps> = ({
  topic,
  setTopic,
  originalLyrics,
  setOriginalLyrics,
  generateLyrics,
  loading,
  generatedLyrics,
}) => {
    const copyToClipboard = () => {
        navigator.clipboard.writeText(generatedLyrics);
      };
  return (
    <div className="">
      <h2 className="text-2xl mx-auto text-center font-bold">
        2: Pick a Topic
      </h2>
      <div className="flex flex-col space-y-4 mt-4 order-2">
        <input
          className="p-2 max-w-sm mx-auto border text-center rounded"
          placeholder="Topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <textarea
          className="p-2 border max-w-md mx-auto text-center rounded"
          placeholder="Original Lyrics"
          rows={10}
          value={originalLyrics}
          onChange={(e) => setOriginalLyrics(e.target.value)}
        ></textarea>
      
      <form className="flex flex-col space-y-4 mt-4 order-2"
  onSubmit={(e) => {
    e.preventDefault();
    generateLyrics(e);
  }}
>
  <button
    type="submit"  // Note the type="submit"
    className="p-2 bg-black text-white max-w-sm mx-auto rounded"
  >
    Generate Lyrics
  </button>
</form>

        {generatedLyrics && (
          <LyricCard lyrics={generatedLyrics} />
        )}
      </div>
    </div>
  );
};

export default LyricsGeneratorForm;