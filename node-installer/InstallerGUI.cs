using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace NeuroStore.Installer
{
    public class SetupForm : Form
    {
        private TextBox txtStorageSize;
        private TextBox txtStoragePath;
        private Button btnBrowse;
        private Button btnInstall;
        private Label lblStatus;
        private ProgressBar prgInstall;

        private const string ServiceName = "NeurostoreNode";
        private const string EmbeddedNodeExe = "neuro-node.exe";

        public SetupForm()
        {
            this.Text = "NeuroStore Node Client Setup";
            this.Size = new Size(540, 360);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.BackColor = Color.FromArgb(245, 247, 250); // Light slate
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            // Header Icon / Banner
            Panel pnlHeader = new Panel();
            pnlHeader.BackColor = Color.FromArgb(16, 185, 129); // Emerald 500
            pnlHeader.Size = new Size(540, 60);
            pnlHeader.Location = new Point(0, 0);

            Label lblHeader = new Label();
            lblHeader.Text = "NeuroStore Node Setup";
            lblHeader.Font = new Font("Segoe UI", 16f, FontStyle.Bold);
            lblHeader.ForeColor = Color.White;
            lblHeader.AutoSize = true;
            lblHeader.Location = new Point(20, 15);
            pnlHeader.Controls.Add(lblHeader);
            this.Controls.Add(pnlHeader);

            // Intro text
            Label lblIntro = new Label();
            lblIntro.Text = "Welcome to the NeuroStore decentralized storage network.\nEarn by securely renting out your excess hard drive space.";
            lblIntro.Location = new Point(20, 80);
            lblIntro.Size = new Size(490, 40);
            this.Controls.Add(lblIntro);

            // Storage Size Label
            Label lblSize = new Label();
            lblSize.Text = "Storage Allocation (GB):";
            lblSize.Location = new Point(20, 135);
            lblSize.AutoSize = true;
            this.Controls.Add(lblSize);

            // Storage Size Input
            txtStorageSize = new TextBox();
            txtStorageSize.Text = "100";
            txtStorageSize.Location = new Point(180, 132);
            txtStorageSize.Size = new Size(100, 25);
            this.Controls.Add(txtStorageSize);

            // Storage Path Label
            Label lblPath = new Label();
            lblPath.Text = "Encrypted Shard Vault:";
            lblPath.Location = new Point(20, 185);
            lblPath.AutoSize = true;
            this.Controls.Add(lblPath);

            // Storage Path Input
            string defaultPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NeuroStore", "node-data");
            txtStoragePath = new TextBox();
            txtStoragePath.Text = defaultPath;
            txtStoragePath.Location = new Point(180, 182);
            txtStoragePath.Size = new Size(240, 25);
            this.Controls.Add(txtStoragePath);

            // Browse Button
            btnBrowse = new Button();
            btnBrowse.Text = "...";
            btnBrowse.Location = new Point(430, 181);
            btnBrowse.Size = new Size(40, 26);
            btnBrowse.Click += BtnBrowse_Click;
            this.Controls.Add(btnBrowse);

            // Status Label
            lblStatus = new Label();
            lblStatus.Text = "Ready to install.";
            lblStatus.ForeColor = Color.Gray;
            lblStatus.Location = new Point(20, 230);
            lblStatus.Size = new Size(490, 20);
            this.Controls.Add(lblStatus);

            // Progress Bar
            prgInstall = new ProgressBar();
            prgInstall.Location = new Point(20, 255);
            prgInstall.Size = new Size(490, 10);
            prgInstall.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(prgInstall);

            // Install Button
            btnInstall = new Button();
            btnInstall.Text = "Install Network Node";
            btnInstall.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            btnInstall.BackColor = Color.FromArgb(16, 185, 129);
            btnInstall.ForeColor = Color.White;
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Location = new Point(350, 280);
            btnInstall.Size = new Size(160, 35);
            btnInstall.Click += BtnInstall_Click;
            btnInstall.Cursor = Cursors.Hand;
            this.Controls.Add(btnInstall);
        }

        private void BtnBrowse_Click(object sender, EventArgs e)
        {
            using (FolderBrowserDialog fbd = new FolderBrowserDialog())
            {
                fbd.Description = "Select a location for the NeuroStore Encrypted Vault";
                fbd.SelectedPath = txtStoragePath.Text;
                if (fbd.ShowDialog() == DialogResult.OK)
                {
                    txtStoragePath.Text = fbd.SelectedPath;
                }
            }
        }

        private void BtnInstall_Click(object sender, EventArgs e)
        {
            int size;
            if (!int.TryParse(txtStorageSize.Text, out size) || size <= 0)
            {
                MessageBox.Show("Please enter a valid amount of gigabytes.", "Input Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            if (string.IsNullOrWhiteSpace(txtStoragePath.Text))
            {
                MessageBox.Show("Please select a valid storage path.", "Input Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            btnInstall.Enabled = false;
            btnBrowse.Enabled = false;
            txtStoragePath.Enabled = false;
            txtStorageSize.Enabled = false;

            lblStatus.Text = "Extracting decentralized node payload...";
            lblStatus.ForeColor = Color.Black;
            prgInstall.Value = 20;

            try
            {
                // Ensure base program data directory exists
                string programData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NeuroStore");
                Directory.CreateDirectory(programData);

                string exeDest = Path.Combine(programData, EmbeddedNodeExe);
                ExtractResource("NeuroStore.Installer.neuro-node.exe", exeDest);

                prgInstall.Value = 50;
                lblStatus.Text = "Generating unique cryptographic node identity...";
                
                // Get the Node ID and pre-allocate folder
                string nodeId = GenerateNodeId(exeDest, txtStoragePath.Text);
                
                prgInstall.Value = 70;
                lblStatus.Text = "Registering Windows Background Service...";

                InstallService(exeDest, size, txtStoragePath.Text, nodeId);

                prgInstall.Value = 100;
                lblStatus.Text = "Installation successful!";
                lblStatus.ForeColor = Color.FromArgb(16, 185, 129);

                MessageBox.Show("NeuroStore Node installed successfully as a silent background service.\nYour Node ID is: " + nodeId, "Setup Complete", MessageBoxButtons.OK, MessageBoxIcon.Information);

                // Open the Web Dashboard
                Process.Start("https://neurostore-next.vercel.app/dashboard/node?node_id=" + nodeId);

                Application.Exit();
            }
            catch (Exception ex)
            {
                lblStatus.Text = "Installation failed!";
                lblStatus.ForeColor = Color.Red;
                MessageBox.Show("Error during installation: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                btnInstall.Enabled = true;
                btnBrowse.Enabled = true;
                txtStoragePath.Enabled = true;
                txtStorageSize.Enabled = true;
            }
        }

        private void ExtractResource(string resourceName, string outPath)
        {
            using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (resStream == null) throw new Exception("Embedded neuro-node.exe resource not found!");
                using (FileStream fs = new FileStream(outPath, FileMode.Create, FileAccess.Write))
                {
                    resStream.CopyTo(fs);
                }
            }
        }

        private string GenerateNodeId(string exePath, string storagePath)
        {
            // Execute the daemon once just to get the peer ID
            ProcessStartInfo info = new ProcessStartInfo(exePath);
            info.Arguments = "--storage-path \"" + storagePath + "\" --print-peer-id";
            info.UseShellExecute = false;
            info.RedirectStandardOutput = true;
            info.CreateNoWindow = true;

            using (Process p = Process.Start(info))
            {
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                
                if (string.IsNullOrWhiteSpace(output))
                {
                    return "NEURO-UNKNOWN";
                }
                
                string peerId = output.Trim();
                if (peerId.Length >= 8)
                {
                    return "NEURO-" + peerId.Substring(0, 8).ToUpper();
                }
                return peerId;
            }
        }

        private void InstallService(string exePath, int maxGb, string storagePath, string nodeId)
        {
            // First stop/delete existing if any
            RunCmd("sc", "stop " + ServiceName);
            RunCmd("sc", "delete " + ServiceName);
            System.Threading.Thread.Sleep(500);

            // Create service
            string binPath = "\"" + exePath + "\" --run-as-service --storage-path \"" + storagePath + "\" --max-gb " + maxGb;
            RunCmd("sc", "create " + ServiceName + " binPath= \"" + binPath + "\" start= auto obj= LocalSystem");
            RunCmd("sc", "description " + ServiceName + " \"NeuroStore Decentralized Storage Network Zero-Knowledge Daemon. Provides disk capacity to the P2P swarm.\"");
            
            // Set failure recovery
            RunCmd("sc", "failure " + ServiceName + " reset= 30 actions= restart/5000/restart/10000/restart/60000");

            // Start it
            RunCmd("sc", "start " + ServiceName);
        }

        private void RunCmd(string file, string args)
        {
            ProcessStartInfo info = new ProcessStartInfo(file, args);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            using (Process p = Process.Start(info))
            {
                p.WaitForExit();
            }
        }
    }

    public static class Program
    {
        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }
}
