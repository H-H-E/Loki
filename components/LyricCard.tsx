/**
 * v0 by Vercel.
 * @see https://v0.dev/t/M3idgABmkME
 */
import { Button } from "./button"
import { CardTitle, CardHeader, CardContent, CardFooter, Card } from "./card"
import { Badge } from "./badge"

export default function LyricCard({ lyrics }: { lyrics: string }) {
  return (
    <div>
      <div>
        <Button className="mb-4" variant="outline">
          <svg
            className=" h-6 w-6 mr-2"
            fill="none"
            height="24"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="6" y2="6" />
            <line x1="4" x2="20" y1="18" y2="18" />
          </svg>
          My History
        </Button>
      </div>
      <div className="w-80 mt-2">
        <div>
          <div className="text-lg font-semibold px-4 py-2">Generated Lyrics</div>
          <div className="px-4 py-2 hover:bg-gray-200 dark:hover:bg-gray-700">
            <Card>
              <CardHeader className="flex items-center space-x-4">
                <img
                  alt="Album Cover"
                  className="rounded-lg"
                  height="80"
                  src="/placeholder.svg"
                  style={{
                    aspectRatio: "80/80",
                    objectFit: "cover",
                  }}
                  width="80"
                />
                <div>
                  <CardTitle className="text-xl font-semibold">Song Title</CardTitle>
                  <p className="text-sm text-gray-500 dark:text-gray-300">Artist Name</p>
                </div>
              </CardHeader>
              <textarea className="p-6 text-sm"
                placeholder="Original Lyrics"
                rows={10}
                value={lyrics}>     </textarea>
              <CardFooter className="flex justify-between items-center">
                <Badge className="items-center" variant="outline">
                  <svg
                    className=" h-3.5 w-3.5 -translate-x-1"
                    fill="none"
                    height="24"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z" />
                    <path d="M10 2c1 .5 2 2 2 5" />
                  </svg>
                  AI-generated
                </Badge>
                <Button size="sm" variant="secondary">
                  View More
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
