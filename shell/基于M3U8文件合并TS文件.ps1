$type = Read-Host "1：使用copy命令合并TS文件（浏览器可能无法正常播放）
2：使用ffmpeg命令合并TS文件（浏览器可正常播放）
3：使用ffmpeg命令合并TS文件并转码（推荐，可能处理较慢）
4：删除所有TS文件（慎重，建议合并没问题之后再进行删除，也可不删除）
5：退出，暂不处理
请输入数字选择处理方式"

Write-Output "开始处理中，请稍候。。。"

# 将当前目录(包括子目录)下的所有HTML文件内容进行合并
Get-ChildItem '*.m3u8' -Recurse | ForEach {
	
	# M3U8文件所在目录
	$m3u8DirName = $_.DirectoryName+ "\"
	
	# TS文件地址
	$tsUrls = @()
	
	# M3U8文件内容
	$m3u8Contents = Get-Content -LiteralPath $_
	$m3u8Contents | ForEach  {
		If ($_ -match '^[^#]') {
			$fileName = $m3u8DirName + $_.SubString(0,$_.LastIndexOf("?"));
			$tsUrls += $fileName
        }
	}
	
	# M3U8文件名称，主要用来合成MP4名称
	$mp4FileName = $m3u8DirName + $_.BaseName + ".mp4"
	$tsFileName = $m3u8DirName + $_.BaseName + ".ts"
	
	if($type -eq 1){
		Write-Output "正在合并，文件：$_"	
		
		$tsFiles = $tsUrls -join " + "
		
		# 执行CMD命令
		# cmd /c 'copy /b 1.ts + 2.ts output.mp4'
		$cmd = "cmd /c 'copy /b " + $tsFiles + " " + $mp4FileName + "'"
		Invoke-Expression "$cmd"
	
		Write-Output "合并完成，合并后文件：$mp4FileName"
	} elseif ($type -eq 2){	
		Write-Output "正在合并，文件：$_"	
			
		$tsFiles = $tsUrls -join "|"
	
		# ffmpeg -i 'concat:1.ts|2.ts' -c copy output.mp4
		$cmd = "ffmpeg -i 'concat:" + $tsFiles + "' -y -c copy " + $mp4FileName
		Invoke-Expression "$cmd"
		
		Write-Output "合并完成，合并后文件：$mp4FileName"
	} elseif ($type -eq 3){	
		Write-Output "正在合并，文件：$_"	
			
		$tsFiles = $tsUrls -join "|"
	
		# ffmpeg -i 'concat:1.ts|2.ts' -c copy output.mp4
		$cmd = "ffmpeg -i 'concat:" + $tsFiles + "' -y -c copy " + $tsFileName
		Invoke-Expression "$cmd"
		
		Write-Output "合并完成，合并后文件：$tsFileName"
	
		Write-Output "正在转码：$tsFileName"
	
		# ffmpeg -i 1.ts -vcodec h264 output.mp4
		$cmd2 = "ffmpeg -i " + $tsFileName + " -y -vcodec h264 " + $mp4FileName
		Invoke-Expression "$cmd2"
		
		Write-Output "转码完成：$mp4FileName"
	} elseif ($type -eq 4){	
		$delType = Read-Host "请再次确认是否删除，确认请输入y"
		
		if($delType -eq "y"){
			Write-Output "正在删除"	
			
			remove-item * -Include *.m3u8,*.ts -Recurse -Force
			
			Write-Output "删除完成"
		} else {
			
			Write-Output "取消删除"
		}
	}
	
	Write-Output "=========================================================="
}

Write-Output "处理完成，按回车退出。。。"

pause