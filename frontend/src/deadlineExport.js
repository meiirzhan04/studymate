
export async function downloadDeadlinesExcel(
  deadlines,
  courseLabel = d => d.course || ''
) {
  const { default: ExcelJS } = await import('exceljs')

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'StudyMate'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Upcoming Deadlines', {
    views: [{ state: 'frozen', ySplit: 7, showGridLines: false }]
  })

  const purple = '6942CF'
  const darkPurple = '43268C'
  const lightPurple = 'F3EEFC'
  const white = 'FFFFFF'
  const dark = '27213D'

  const now = new Date()

  const sorted = [...deadlines].sort(
    (a, b) => new Date(a.due_at) - new Date(b.due_at)
  )

  const courses = new Set(
    sorted.map(d => courseLabel(d)).filter(Boolean)
  )

  sheet.columns = [
    { key: 'number', width: 8 },
    { key: 'assignment', width: 48 },
    { key: 'course', width: 42 },
    { key: 'due', width: 30 },
    { key: 'days', width: 14 },
    { key: 'priority', width: 18 }
  ]

  const fill = color => ({
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF' + color }
  })

  // Report title
  sheet.mergeCells('A1:F1')

  const title = sheet.getCell('A1')
  title.value = 'StudyMate'
  title.font = {
    name: 'Calibri',
    size: 26,
    bold: true,
    color: { argb: 'FFFFFFFF' }
  }
  title.fill = fill(darkPurple)
  title.alignment = {
    vertical: 'middle',
    indent: 1
  }

  sheet.getRow(1).height = 46

  // Report subtitle
  sheet.mergeCells('A2:F2')

  const subtitle = sheet.getCell('A2')
  subtitle.value = 'Upcoming Deadlines Report'
  subtitle.font = {
    size: 15,
    bold: true,
    color: { argb: 'FF' + purple }
  }
  subtitle.fill = fill(lightPurple)
  subtitle.alignment = {
    vertical: 'middle',
    indent: 1
  }

  sheet.getRow(2).height = 30

  // Generation date
  sheet.mergeCells('A3:F3')

  sheet.getCell('A3').value =
    `Generated: ${now.toLocaleString('en-GB')}`

  sheet.getCell('A3').font = {
    size: 11,
    italic: true,
    color: { argb: 'FF777085' }
  }

  sheet.getRow(3).height = 24

  // Summary cards
  sheet.mergeCells('A5:B5')
  sheet.mergeCells('C5:D5')
  sheet.mergeCells('E5:F5')

  const summary = [
    ['A5', `Total deadlines: ${sorted.length}`],
    ['C5', `Total courses: ${courses.size}`],
    [
      'E5',
      sorted.length
        ? `Next due: ${new Date(sorted[0].due_at).toLocaleDateString('en-GB')}`
        : 'No deadlines'
    ]
  ]

  summary.forEach(([address, value]) => {
    const cell = sheet.getCell(address)

    cell.value = value
    cell.fill = fill(lightPurple)

    cell.font = {
      bold: true,
      size: 13,
      color: { argb: 'FF' + darkPurple }
    }

    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle'
    }
  })

  sheet.getRow(5).height = 36

  // Table headers
  const header = sheet.getRow(7)

  header.values = [
    'No.',
    'Assignment',
    'Course',
    'Due Date (Local Time)',
    'Days Left',
    'Priority'
  ]

  header.height = 32

  header.eachCell(cell => {
    cell.fill = fill(purple)

    cell.font = {
      name: 'Calibri',
      size: 12,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    }

    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center'
    }
  })

  // Deadline records
  sorted.forEach((deadline, index) => {
    const due = new Date(deadline.due_at)
    const validDate = !Number.isNaN(due.getTime())

    const daysLeft = validDate
      ? Math.ceil((due.getTime() - now.getTime()) / 86400000)
      : null

    let priority = 'Unknown'
    let priorityColor = '777085'
    let priorityBackground = 'F2F2F2'

    if (validDate) {
      if (due < now) {
        priority = 'Overdue'
        priorityColor = 'B91C1C'
        priorityBackground = 'FEE2E2'
      } else if (daysLeft <= 1) {
        priority = 'Urgent'
        priorityColor = 'B91C1C'
        priorityBackground = 'FEE2E2'
      } else if (daysLeft <= 3) {
        priority = 'High'
        priorityColor = 'B45309'
        priorityBackground = 'FEF3C7'
      } else {
        priority = 'Upcoming'
        priorityColor = '15803D'
        priorityBackground = 'DCFCE7'
      }
    }

    const row = sheet.getRow(index + 8)

    row.values = [
      index + 1,
      String(deadline.title || ''),
      String(courseLabel(deadline) || ''),
      validDate 
       ? new Date(due.getTime() - due.getTimezoneOffset() * 60000) 
       : '',
      daysLeft ?? '',
      priority
    ]

    row.height = 38

    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = fill(
        index % 2 === 0 ? lightPurple : white
      )

      cell.font = {
        name: 'Calibri',
        size: 12,
        color: { argb: 'FF' + dark }
      }

      cell.alignment = {
        vertical: 'middle',
        wrapText: true
      }

      cell.border = {
        bottom: {
          style: 'thin',
          color: { argb: 'FFE5E0F0' }
        }
      }
    })

    row.getCell(4).numFmt = 'dd mmm yyyy, hh:mm'

    ;[1, 4, 5, 6].forEach(column => {
      row.getCell(column).alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true
      }
    })

    const priorityCell = row.getCell(6)

    priorityCell.fill = fill(priorityBackground)

    priorityCell.font = {
      bold: true,
      color: { argb: 'FF' + priorityColor }
    }
  })

  // Excel filtering
  sheet.autoFilter = {
    from: 'A7',
    to: `F${Math.max(7, sorted.length + 7)}`
  }

  // Report footer
  const footerRow = sorted.length + 10

  sheet.mergeCells(`A${footerRow}:F${footerRow}`)

  const footer = sheet.getCell(`A${footerRow}`)

  footer.value =
    'Generated by StudyMate | Personal Academic Planner'

  footer.font = {
    italic: true,
    size: 10,
    color: { argb: 'FF777085' }
  }

  footer.alignment = {
    horizontal: 'center'
  }

  // Download the Excel file
  const buffer = await workbook.xlsx.writeBuffer()

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })

  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = 'StudyMate-Upcoming-Deadlines.xlsx'

  document.body.appendChild(link)
  link.click()
  link.remove()

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
