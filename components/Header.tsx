import Image from "next/image";
import Link from "next/link";
import{Button }  from "../components/button"

export default function Header() {
  return (
    <header className="flex justify-center items-center w-full mt-5 border-b-2 pb-7 sm:px-4 px-2">
      <Link href="/" className="flex space-x-3">
      <h1 className="sm:text-3xl pt-6   text-xl font-bold ml-2 tracking-tight">
         Loki 
       </h1>
       <br></br>
        <Image
          alt="header text"
          src="/lokilyrics.png"
          className=" font-bold ml-2 tracking-tight"
          width={90}
          height={90}
         
        />
     
      </Link>
      <a
        href="https://2022.poiesis.education"
        target="_blank"
        rel="noreferrer"
      >
      </a>
      <Button className="ml-auto" >

        <Link className="text-white bg-blue-500 hover:bg-blue-700 text-sm font-semibold py-2 px-4 rounded" href="./history">
          
            History
          
        </Link>




      </Button>
      
    </header>
  );
}
